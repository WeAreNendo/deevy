import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname } from "node:path";

/**
 * git as the session reaches it: on loopback, with no credential, forwarded to
 * the real remote by the supervisor.
 *
 * The same shape as the MCP proxy (src/proxy.ts) and for the same reason. A
 * credential helper is the obvious alternative and is not one: it hands git the
 * token, so anything that can run git can run the helper and print it. A proxy
 * has nothing to hand over — the session pushes to a loopback URL, and the
 * token exists only in this process (docs/plans/agent-owns-git.md, ADR-0019).
 *
 * What the session may push is deliberately not decided here. Where an Agent
 * can push is the scope of the token the operator issued and whatever the forge
 * protects; the runtime's job is to make every ref it moved a fact a Human
 * reads, which is `src/refs.ts`.
 */
export interface GitProxyOptions {
  /** The real remote: an `https://` URL, or a path to a repository on disk. */
  upstream: string;
  /** The credential, added on the way out. The session never holds it. */
  token?: string;
  /** The user the token goes with, as the provider that minted it named it. */
  username?: string;
}

export interface GitProxy {
  /** What `origin` is set to: `http://127.0.0.1:<port>/<name>`. */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Headers the upstream must not be given back, or that this process owns. */
const droppedResponseHeaders = new Set(["connection", "keep-alive", "transfer-encoding"]);

export function openGitProxy(options: GitProxyOptions): Promise<GitProxy> {
  const name = repositoryName(options.upstream);

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.startsWith(`/${name}`) ? url.pathname.slice(name.length + 1) : null;
    if (path === null) {
      response.writeHead(404).end("not found");
      return;
    }
    const body = await read(request);
    const query = url.search.slice(1);
    await (remoteUpstream(options.upstream)
      ? forward(options, path, query, request, body, response)
      : serveLocally(options.upstream, path, query, request, body, response));
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end(`the remote could not be reached: ${detail}`);
    });
  });

  return new Promise((resolve) => {
    // Loopback by address rather than by checking who connected: a listener
    // bound to 127.0.0.1 has nothing to check.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/${name}`,
        port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Whether the remote is somewhere else, rather than a repository on this disk. */
export function remoteUpstream(upstream: string): boolean {
  return /^https?:\/\//.test(upstream);
}

/** Headers a client sends that the upstream should see, less the ones this process owns. */
const forwardedRequestHeaders = [
  "accept",
  "accept-encoding",
  "content-type",
  "content-encoding",
  "git-protocol",
  "user-agent",
];

/**
 * The real remote, reached with the credential the session does not have.
 *
 * Bytes in and bytes out: git's own protocol, unread. What the session pushed
 * is established afterwards by comparing the remote's refs (src/refs.ts), which
 * is why nothing here parses a packfile.
 */
async function forward(
  options: GitProxyOptions,
  path: string,
  query: string,
  request: IncomingMessage,
  body: Buffer,
  response: ServerResponse,
): Promise<void> {
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers[name];
    const one = Array.isArray(value) ? value[0] : value;
    if (one !== undefined) headers.set(name, one);
  }
  if (options.token) {
    // The same credential the supervisor clones with, in the form git uses for
    // a token (src/workspace.ts), added here and nowhere the session can read.
    const basic = Buffer.from(`${options.username ?? "x-access-token"}:${options.token}`).toString(
      "base64",
    );
    headers.set("authorization", `Basic ${basic}`);
  }
  const target = `${options.upstream.replace(/\/+$/, "")}${path}${query ? `?${query}` : ""}`;
  const init: RequestInit = { method: request.method ?? "GET", headers, redirect: "follow" };
  // A Buffer as the bytes it is: the packfile git sent, forwarded unread.
  if (request.method === "POST") init.body = new Uint8Array(body);
  const answered = await fetch(target, init);

  const out: Record<string, string> = {};
  answered.headers.forEach((value, name) => {
    if (!droppedResponseHeaders.has(name) && name !== "content-encoding") out[name] = value;
  });
  // The forge's own words on a refusal, whatever they were: "the remote said
  // no" with no reason is the worst thing a session can be told.
  response.writeHead(answered.status, out);
  if (!answered.body) {
    response.end();
    return;
  }
  for await (const chunk of answered.body) response.write(chunk);
  response.end();
}

/** What the repository is called, which is the one path segment the proxy serves. */
export function repositoryName(upstream: string): string {
  const withoutSlash = upstream.replace(/\/+$/, "");
  const last = /^https?:\/\//.test(withoutSlash)
    ? (new URL(withoutSlash).pathname.split("/").pop() ?? "")
    : basename(withoutSlash);
  return last === "" ? "repository.git" : last;
}

/**
 * A repository on disk, served by git's own CGI.
 *
 * `git http-backend` is what every git server runs behind its HTTP endpoint, so
 * a path remote and an origin on the internet reach the session as the same
 * protocol — which is what keeps this one code path rather than two, and what
 * lets the acceptance walk stay on this machine (docs/sockets-acceptance.md).
 */
async function serveLocally(
  upstream: string,
  path: string,
  query: string,
  request: IncomingMessage,
  body: Buffer,
  response: ServerResponse,
): Promise<void> {
  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  // `http.receivepack` because git's CGI refuses an anonymous push by default,
  // and the client here is the session: what it may push is the token's scope
  // and the forge's protections to decide, not this listener's (ADR-0019).
  const backend = spawn("git", ["-c", "http.receivepack=true", "http-backend"], {
    env: {
      PATH: process.env.PATH ?? "",
      GIT_PROJECT_ROOT: dirname(upstream.replace(/\/+$/, "")),
      // The repository is the runtime's own configuration, and the only one
      // this listener serves; a marker file in it would say the same thing.
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: `/${basename(upstream.replace(/\/+$/, ""))}${path}`,
      REQUEST_METHOD: request.method ?? "GET",
      QUERY_STRING: query,
      CONTENT_TYPE: header("content-type") ?? "",
      CONTENT_LENGTH: String(body.length),
      // Protocol v2 is what modern git asks for, and it asks in a header.
      ...(header("git-protocol") ? { GIT_PROTOCOL: header("git-protocol") as string } : {}),
      ...(header("content-encoding")
        ? { HTTP_CONTENT_ENCODING: header("content-encoding") as string }
        : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  // The backend may answer before it has read what it was sent — a push it
  // refuses at the door, a request it wants no body for — and exit, at which
  // point what is still being written into its stdin fails with EPIPE. That is
  // not a failure of the request: its answer is on stdout and is relayed below.
  // Left unhandled, the pipe's error is an uncaught exception, and the whole
  // supervisor goes down because one CGI finished early.
  backend.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") console.error(`git http-backend stdin: ${error.message}`);
  });
  backend.stdin.end(body);
  await relayCgi(backend, response);
}

/**
 * A CGI answer as an HTTP one: headers, then the body streamed rather than
 * held, because a clone's packfile is as big as the repository.
 */
function relayCgi(backend: ChildProcess, response: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdout = backend.stdout;
    if (!stdout) {
      reject(new Error("git http-backend has no stdout to answer on"));
      return;
    }
    // A git that is not there, or cannot be started, is the request failing
    // rather than the process: the caller turns this into a 502 that says so.
    // Its stdout still ends, empty, a tick later, and must not answer again.
    let settled = false;
    backend.on("error", (error) => {
      settled = true;
      reject(error);
    });
    let head = Buffer.alloc(0);
    let sending = false;
    stdout.on("data", (chunk: Buffer) => {
      if (sending) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      const [status, headers] = parseCgiHead(head.subarray(0, end).toString("utf8"));
      response.writeHead(status, headers);
      sending = true;
      const rest = head.subarray(end + 4);
      if (rest.length > 0) response.write(rest);
    });
    stdout.on("end", () => {
      if (settled) return;
      settled = true;
      if (!sending) response.writeHead(500, { "content-type": "text/plain" }).end("no answer");
      response.end();
      resolve();
    });
    stdout.on("error", reject);
  });
}

function parseCgiHead(text: string): [number, Record<string, string>] {
  let status = 200;
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (name === "status") {
      status = Number.parseInt(value, 10) || 200;
      continue;
    }
    if (!droppedResponseHeaders.has(name)) headers[name] = value;
  }
  return [status, headers];
}

async function read(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

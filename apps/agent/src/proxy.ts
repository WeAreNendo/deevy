import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * deevy's MCP endpoint, as the session sees it: on loopback, with no
 * credential, and offering exactly the tools the runtime grants.
 *
 * The session is a subprocess with a shell, running as the same user as this
 * process. Anything this process hands the harness — an argument, an
 * environment variable, a file — that shell can read back, and the Agent's
 * key in an MCP header is every operation the Agent may call, over `curl`,
 * including the ones deliberately left out of the tool list (ADR-0014). So the
 * key stays here: the harness is pointed at `http://127.0.0.1:<port>/mcp`,
 * and this forwards to deevy with the header the session never held.
 *
 * It is also where the deevy-tool allowlist is enforced. `tools/list` is
 * filtered to the granted names and `tools/call` on any other name is refused
 * before it reaches deevy, so what a session may call is decided in one place
 * whichever harness is asking, and a refusal is one `denied` event from one
 * source. A shell that reaches this port gets the allowlisted tools and no
 * others, which is the allowlist and not a hole (docs/plans/harnesses.md).
 *
 * Everything else is bytes: the request goes to deevy as it arrived, less the
 * headers this process owns, and the answer comes back as deevy sent it — JSON
 * or an event stream, since a Gate elicitation is served over SSE.
 */
export interface ProxyOptions {
  /** deevy's origin, without a trailing slash. */
  url: string;
  /** The Agent's key. It is added here and nowhere the session can see. */
  key: string;
  /** The tool names the session may call, as deevy names them. */
  tools: ReadonlyArray<string>;
  /**
   * Called with the name of every tool the session asked for and was refused,
   * and awaited before the session is answered, so whatever it records is
   * recorded before the model's next move.
   */
  onDenied?: (name: string) => void | Promise<void>;
  /**
   * Called with every granted tool call and its arguments, and awaited before
   * the call is forwarded, so whatever the supervisor owes deevy first reaches
   * it first: the delivery, before a session's `runs_finish` closes the feed
   * that delivery is said in (src/work.ts).
   */
  onCall?: (name: string, args: Record<string, unknown>) => void | Promise<void>;
  /**
   * The fetch that reaches deevy. A test hands it the app's own handler, so
   * the forwarded request goes through the same routing and authentication a
   * deployed instance uses.
   */
  fetch?: typeof globalThis.fetch;
}

export interface Proxy {
  /** What the harness is configured with: `http://127.0.0.1:<port>/mcp`. */
  url: string;
  port: number;
  /**
   * Whether deevy answers this key, asked the way the session will ask. `null`
   * means it does; a string is the reason it does not, for the Run's feed.
   */
  probe(): Promise<string | null>;
  close(): Promise<void>;
}

/** The protocol revision the runtime speaks (docs/research/mcp-spec-2026-07-28.md). */
export const mcpProtocolVersion = "2026-07-28";

/**
 * What every request of that revision carries in `_meta`, since there is no
 * handshake to carry it once. The probe sends it; a harness sends its own.
 */
export const mcpEnvelope = {
  "io.modelcontextprotocol/protocolVersion": mcpProtocolVersion,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "deevy-runtime", version: "0" },
};

/** Headers this process owns or the upstream must not see again. */
const droppedRequestHeaders = new Set([
  "host",
  "authorization",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "expect",
]);

/** Headers `fetch` has already acted on, so passing them back would lie. */
const droppedResponseHeaders = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

/** As much of a JSON-RPC message as the proxy reads. */
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: unknown; arguments?: unknown };
  result?: { tools?: Array<{ name: string }> };
  error?: { code: number; message: string };
}

interface Forwarded {
  status: number;
  headers: Headers;
  body: WebReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export function openProxy(options: ProxyOptions): Promise<Proxy> {
  const fetch = options.fetch ?? globalThis.fetch;
  const upstream = `${options.url}/mcp`;
  const granted = new Set(options.tools);

  async function forward(
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<Forwarded> {
    const sent = new Headers();
    for (const [name, value] of Object.entries(headers)) {
      if (!droppedRequestHeaders.has(name)) sent.set(name, value);
    }
    sent.set("authorization", `Bearer ${options.key}`);
    const response = await fetch(upstream, {
      method,
      headers: sent,
      ...(body === undefined ? {} : { body }),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body as WebReadableStream<Uint8Array> | null,
      text: () => response.text(),
    };
  }

  /** deevy's own answer, streamed back as it came. */
  function relay(upstreamResponse: Forwarded, response: ServerResponse): void {
    const headers: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, name) => {
      if (!droppedResponseHeaders.has(name)) headers[name] = value;
    });
    response.writeHead(upstreamResponse.status, headers);
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstreamResponse.body).pipe(response);
  }

  async function refuse(
    response: ServerResponse,
    id: JsonRpcMessage["id"],
    name: string,
  ): Promise<void> {
    await options.onDenied?.(name);
    const error = {
      jsonrpc: "2.0",
      id: id ?? null,
      // Invalid params, which is what the protocol says about a tool that is
      // not in `tools/list`: to this session, it does not exist.
      error: { code: -32602, message: `Tool ${name} is not available to this session` },
    };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(error));
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url !== "/mcp") {
      response.writeHead(404).end("not found");
      return;
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      const one = Array.isArray(value) ? value[0] : value;
      if (one !== undefined) headers[name] = one;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const method = request.method ?? "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : raw;

    const message = method === "POST" ? parse(raw) : null;
    if (Array.isArray(message)) {
      // The 2026-07-28 revision took batching out, and a batch is the one
      // shape in which a refused call could hide beside an allowed one.
      response.writeHead(400).end("batched JSON-RPC requests are not accepted");
      return;
    }
    if (message?.method === "tools/call") {
      const name = message.params?.name;
      if (typeof name !== "string" || !granted.has(name)) {
        await refuse(response, message.id, typeof name === "string" ? name : "?");
        return;
      }
      await options.onCall?.(name, argumentsOf(message.params?.arguments));
    }

    const answered = await forward(method, headers, body);
    if (message?.method !== "tools/list" || answered.status !== 200) {
      relay(answered, response);
      return;
    }

    // The one answer that is read rather than relayed: the tool list, narrowed
    // to what this session may call. deevy already narrows it to what the
    // Agent may call, and the runtime narrows it again to what this program
    // grants, which is the smaller set.
    const text = await answered.text();
    const listed = messagesIn(text, answered.headers.get("content-type") ?? "");
    const reply = listed.find((m) => Array.isArray(m.result?.tools));
    if (!reply?.result?.tools) {
      response.writeHead(200, { "content-type": "application/json" }).end(text);
      return;
    }
    const filtered = {
      ...reply,
      result: { ...reply.result, tools: reply.result.tools.filter((t) => granted.has(t.name)) },
    };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(filtered));
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      // deevy unreachable, or a body that was not what it said. The session
      // gets a 502 and the model sees a tool that failed, which is the truth.
      const detail = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end(`deevy could not be reached: ${detail}`);
    });
  });

  return new Promise((resolve) => {
    // Loopback by address, not by checking who connected: a listener bound to
    // 127.0.0.1 has nothing to check.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        port,
        async probe() {
          // The 2026-07-28 revision has no `initialize`: every request carries
          // its envelope in `_meta`, and a `tools/list` is the smallest one
          // that proves the key is this Agent's.
          try {
            const answered = await forward(
              "POST",
              {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-protocol-version": mcpProtocolVersion,
                // The revision wants the method in a header as well as the
                // body, so an edge can route without parsing.
                "mcp-method": "tools/list",
              },
              JSON.stringify({
                jsonrpc: "2.0",
                id: 0,
                method: "tools/list",
                params: { _meta: mcpEnvelope },
              }),
            );
            const text = await answered.text();
            if (answered.status !== 200) {
              return `deevy answered ${answered.status} to tools/list: ${text.slice(0, 200)}`;
            }
            const listed = messagesIn(text, answered.headers.get("content-type") ?? "");
            return listed.some((m) => Array.isArray(m.result?.tools))
              ? null
              : `deevy did not list its tools: ${text.slice(0, 200)}`;
          } catch (error) {
            return `deevy is unreachable at ${options.url}: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * A tool call's arguments as the supervisor reads them: the object the
 * protocol says they are, or one a client sent as a JSON string, or nothing.
 */
function argumentsOf(value: unknown): Record<string, unknown> {
  let args = value;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return {};
    }
  }
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/** One JSON-RPC message, a batch, or null for a body that is not JSON. */
function parse(raw: string): JsonRpcMessage | JsonRpcMessage[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as JsonRpcMessage) : null;
  } catch {
    return null;
  }
}

/**
 * The JSON-RPC messages in an HTTP body, whichever way the server chose to
 * send them: one JSON document, or an event stream whose `data:` lines carry
 * one message each.
 */
export function messagesIn(text: string, contentType: string): JsonRpcMessage[] {
  if (!contentType.includes("text/event-stream")) {
    const one = parse(text);
    return one === null ? [] : Array.isArray(one) ? one : [one];
  }
  const messages: JsonRpcMessage[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    const one = parse(data);
    if (one !== null) messages.push(...(Array.isArray(one) ? one : [one]));
  }
  return messages;
}

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openGitProxy } from "../src/git-proxy.ts";

const run = promisify(execFile);
const scratch: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A git command, run with nothing of the operator's configuration in it. */
async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run("git", args, {
    ...(cwd ? { cwd } : {}),
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "a session",
      GIT_AUTHOR_EMAIL: "session@deevy.test",
      GIT_COMMITTER_NAME: "a session",
      GIT_COMMITTER_EMAIL: "session@deevy.test",
    },
  });
  return stdout.trim();
}

/** A bare repository with one commit on `main`, the way a remote is one. */
async function upstream(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-upstream-"));
  scratch.push(dir);
  const bare = join(dir, "origin.git");
  const seed = join(dir, "seed");
  await git(["init", "--bare", "--initial-branch", "main", "--quiet", bare]);
  await git(["clone", "--quiet", bare, seed]);
  await writeFile(join(seed, "README.md"), "# upstream\n");
  await git(["add", "-A"], seed);
  await git(["commit", "--quiet", "-m", "first"], seed);
  await git(["push", "--quiet", "origin", "main"], seed);
  return bare;
}

/** A remote on the internet, as far as the proxy can tell, that says what it was asked. */
async function recordingRemote(seen: Array<string | undefined>): Promise<string> {
  const server = createServer((request, response) => {
    seen.push(request.headers.authorization);
    response.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement" });
    response.end("0000");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  closers.push(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${String(port)}`;
}

async function proxyFor(options: { upstream: string; token?: string }) {
  const proxy = await openGitProxy(options);
  closers.push(() => proxy.close());
  return proxy;
}

/**
 * A `git` the proxy finds first on PATH, for as long as the test runs. The
 * script is the whole of what it does; an empty string is a directory with no
 * git in it at all.
 */
async function gitOnPath(script: string | null): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-fake-git-"));
  scratch.push(dir);
  if (script !== null) {
    await writeFile(join(dir, "git"), script);
    await chmod(join(dir, "git"), 0o755);
  }
  const was = process.env.PATH;
  process.env.PATH = script === null ? dir : `${dir}:${was ?? ""}`;
  closers.push(() => {
    process.env.PATH = was;
    return Promise.resolve();
  });
}

describe("git through the supervisor", () => {
  it("answers a client that has no credential of its own", async () => {
    const remote = await upstream();
    const proxy = await proxyFor({ upstream: remote });

    const refs = await git(["ls-remote", proxy.url]);

    expect(refs).toContain("refs/heads/main");
  });

  it("carries a push through to the remote, on the branch the session chose", async () => {
    const remote = await upstream();
    const proxy = await proxyFor({ upstream: remote });
    const work = await mkdtemp(join(tmpdir(), "deevy-session-"));
    scratch.push(work);

    await git(["clone", "--quiet", proxy.url, work]);
    await git(["checkout", "--quiet", "-b", "whatever-it-likes"], work);
    await writeFile(join(work, "feature.ts"), "export const x = 1;\n");
    await git(["add", "-A"], work);
    await git(["commit", "--quiet", "-m", "the words the agent chose"], work);
    await git(["push", "--quiet", "origin", "whatever-it-likes"], work);

    expect(await git(["ls-remote", remote])).toContain("refs/heads/whatever-it-likes");
    expect(await git(["log", "-1", "--format=%s", "whatever-it-likes"], remote)).toBe(
      "the words the agent chose",
    );
  });

  it("adds the credential on the way out, and never hands it to the session", async () => {
    const seen: Array<string | undefined> = [];
    const remote = await recordingRemote(seen);
    const proxy = await proxyFor({ upstream: `${remote}/owner/repo.git`, token: "ghp_secret" });

    const answered = await fetch(`${proxy.url}/info/refs?service=git-upload-pack`);

    expect(answered.status).toBe(200);
    expect(seen).toEqual([`Basic ${Buffer.from("x-access-token:ghp_secret").toString("base64")}`]);
    // What the session is given is a loopback URL and nothing else: it holds no
    // credential, so there is none for a shell in it to find.
    expect(proxy.url).not.toContain("ghp_secret");
  });

  it("relays an answer the backend gave before it read what it was sent", async () => {
    const remote = await upstream();
    // A CGI that answers at once and never reads its stdin, the way http-backend
    // does when it refuses a push at the door: its exit closes the pipe while
    // the body is still being written into it, which is EPIPE on this side.
    await gitOnPath(
      "#!/bin/sh\nprintf 'Status: 403\\r\\nContent-Type: text/plain\\r\\n\\r\\nnot here'\n",
    );
    const proxy = await proxyFor({ upstream: remote });

    const answered = await fetch(`${proxy.url}/git-receive-pack`, {
      method: "POST",
      headers: { "content-type": "application/x-git-receive-pack-request" },
      // Larger than a pipe holds, so the write is still under way when the
      // backend is gone rather than parked in the kernel's buffer.
      body: new Uint8Array(4 * 1024 * 1024),
    });

    expect(answered.status).toBe(403);
    expect(await answered.text()).toBe("not here");
  });

  it("says so when there is no git to serve the repository with", async () => {
    const remote = await upstream();
    await gitOnPath(null);
    const proxy = await proxyFor({ upstream: remote });

    const answered = await fetch(`${proxy.url}/info/refs?service=git-upload-pack`);

    expect(answered.status).toBe(502);
    expect(await answered.text()).toMatch(/could not be reached/);
  });
});

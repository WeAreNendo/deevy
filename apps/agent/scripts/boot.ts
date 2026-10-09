/**
 * deevy, on every deployment, on this machine and nothing else.
 *
 * The acceptance walk's claim is that the runtime cannot tell them apart
 * (ADR-0006), so it has to be able to start each: a Node process from the
 * packed bundle, workerd from the built Worker on a local D1, and workerd from
 * the many-Workspaces Worker with a Workspace in a Durable Object (ADR-0028).
 * None needs an account, and sign-in is an OAuth stub prepended to the bundle
 * — the same trick `apps/web/scripts/smoke-workers.ts` uses, and the reason
 * this walk needs no OAuth App either (docs/sockets-acceptance.md).
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localConfigs, platform, startLocal } from "../../hosted/scripts/local.ts";

const here = new URL(".", import.meta.url).pathname;
const root = join(here, "../../..");
const stub = join(root, "apps/web/scripts/stub-oauth.js");
const wrangler = join(root, "apps/web/node_modules/.bin/wrangler");
const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

export interface Deployment {
  name: string;
  origin: string;
  /**
   * Makes this deployment do the background work it owes: the Socket mirror
   * that says a Gate is waiting, and the sweeps beside it.
   *
   * Node runs it on a timer this walk sets to a second, so there is nothing to
   * do; workerd's Cron Trigger does not fire under `wrangler dev`, so it is
   * poked. The walk waits for what the work produces either way, which is why
   * one of these can do nothing at all (apps/web/scripts/smoke-workers.ts).
   */
  tick(): Promise<void>;
  stop(): void;
}

/** The email `DEEVY_ADMIN_EMAIL` names, whose first sign-in bootstraps the Workspace. */
export const adminEmail = "ada@example.com";
export const secret = "acceptance-secret-acceptance-secret-32";
/** What a Socket's credentials and its webhook secret are sealed with (secrets.ts). */
export const sealingSecret = "acceptance-sealing-acceptance-sealing-32";

export interface StartOptions {
  /**
   * What the stubbed tracker holds: `name[=cloneUrl]`, separated by commas.
   * A store lives inside the deevy process, so this is the only way a walk
   * outside it can say what the tracker contains (packages/sockets/src/stub).
   */
  containers: string;
  /**
   * The path the deployment lives under, when it lives under one: a hosted
   * Workspace's `/acme`, an operator's `/deevy` (docs/plans/hosted.md). Its
   * URL is the origin and this, and everything the walk calls is under it.
   */
  basePath?: string;
}

/** A port nothing is on, taken and released, so a sign-in origin can be named up front. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForReady(child: ChildProcess, what: string, ready: RegExp): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const watch = (chunk: Buffer) => {
      output += chunk.toString();
      if (ready.test(output)) resolve();
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("error", reject);
    child.on("exit", (code) => {
      reject(new Error(`${what} exited ${String(code)} before it was ready:\n${output}`));
    });
    setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${what} was not ready in 60s:\n${output}`));
    }, 60_000).unref();
  });
}

/** The bundle with the outside world replaced, written beside the original. */
async function stubbed(bundle: string, into: string): Promise<string> {
  const [oauth, source] = await Promise.all([readFile(stub, "utf8"), readFile(bundle, "utf8")]);
  await writeFile(into, `${oauth}\n${source}`);
  return into;
}

/** deevy as the Docker image runs it: one Node process, SQLite on disk. */
export async function startNode({ containers, basePath = "" }: StartOptions): Promise<Deployment> {
  const dist = join(root, "apps/server/dist");
  const entry = await stubbed(join(dist, "index.mjs"), join(dist, "index.acceptance.mjs"));
  const port = await freePort();
  const origin = `http://localhost:${String(port)}${basePath}`;
  const data = await mkdtemp(join(tmpdir(), "deevy-acceptance-node-"));

  const child = spawn("node", [entry], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...childEnv,
      DEEVY_PORT: String(port),
      DEEVY_DATABASE_PATH: join(data, "deevy.sqlite"),
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: secret,
      GITHUB_CLIENT_ID: "acceptance",
      GITHUB_CLIENT_SECRET: "acceptance",
      DEEVY_ADMIN_EMAIL: adminEmail,
      DEEVY_SECRET: sealingSecret,
      // The provider that is not a tool, and what it holds (ADR-0024).
      DEEVY_DEV_STUB_SOCKETS: "1",
      DEEVY_DEV_STUB_CONTAINERS: containers,
      // The background runner, as often as it can: what a Gate says back in
      // the tracker is a delivery it sends, and the walk waits for it.
      DEEVY_SWEEP_INTERVAL_SECONDS: "1",
    },
  });
  await waitForReady(child, "the Node server", /deevy listening on/);
  return {
    name: basePath ? "node under a path" : "node",
    origin,
    // Nothing: the runner's own timer is the tick here.
    tick: () => Promise.resolve(),
    stop: () => child.kill("SIGTERM"),
  };
}

function runToCompletion(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}:\n${output}`)),
    );
  });
}

/** deevy on workerd, with a local D1. `wrangler dev --local` needs no account. */
export async function startWorkers({ containers }: StartOptions): Promise<Deployment> {
  const built = join(root, "apps/web/dist/deevy");
  await stubbed(join(built, "index.js"), join(built, "index.acceptance.js"));
  const config = join(built, "wrangler.acceptance.json");
  const written = JSON.parse(await readFile(join(built, "wrangler.json"), "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(config, JSON.stringify({ ...written, main: "index.acceptance.js" }));

  const port = await freePort();
  const origin = `http://localhost:${String(port)}`;
  const persistTo = await mkdtemp(join(tmpdir(), "deevy-acceptance-d1-"));

  // The local D1 starts empty, and wrangler is the only thing that migrates a
  // D1 (ADR-0008). Without this every request is an Internal Server Error, and
  // the first one a walk makes is a sign-in.
  await runToCompletion(wrangler, [
    "d1",
    "migrations",
    "apply",
    "deevy",
    "--local",
    "--config",
    config,
    "--persist-to",
    persistTo,
  ]);
  const vars: Record<string, string> = {
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret,
    GITHUB_CLIENT_ID: "acceptance",
    GITHUB_CLIENT_SECRET: "acceptance",
    DEEVY_ADMIN_EMAIL: adminEmail,
    DEEVY_SECRET: sealingSecret,
    DEEVY_DEV_STUB_SOCKETS: "1",
    DEEVY_DEV_STUB_CONTAINERS: containers,
  };

  const child = spawn(
    wrangler,
    [
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      ...Object.entries(vars).flatMap(([name, value]) => ["--var", `${name}:${value}`]),
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: childEnv },
  );
  await waitForReady(child, "wrangler dev", /Ready on https?:\/\//);
  return {
    name: "workers",
    origin,
    /*
     * One Cron Trigger, waited for: workerd holds the invocation open for
     * `ctx.waitUntil`, so a 200 is the pass having finished.
     *
     * `/cdn-cgi/handler/scheduled` rather than `--test-scheduled`'s
     * `/__scheduled`, which a Worker that also serves assets answers with the
     * SPA's index.html and a 200 that ran nothing — the same trap
     * `apps/web/scripts/smoke-workers.ts` documents.
     */
    tick: async () => {
      const fired = await fetch(
        `${origin}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}`,
      );
      await fired.text();
    },
    stop: () => child.kill("SIGTERM"),
  };
}

/**
 * deevy as a hosted Workspace runs (ADR-0028): the many-Workspaces Worker on
 * workerd beside the stand-in console, one Workspace provisioned through
 * `Platform` the way the console provisions one, and the walk at its URL —
 * `/acme` on the host, its database in an object of its own. Signing in goes
 * through the relay at the root of the host, as every hosted sign-in does.
 * Built by `vp run hosted#build:hosted`, after the SPA.
 */
export async function startHosted({ containers }: StartOptions): Promise<Deployment> {
  const port = await freePort();
  const host = `http://localhost:${String(port)}`;
  const files = await localConfigs({
    label: "acceptance",
    origin: host,
    vars: {
      DEEVY_DEV_STUB_SOCKETS: "1",
      DEEVY_DEV_STUB_CONTAINERS: containers,
      // The Workspace's alarm, as often as it can: what a Gate says back in
      // the tracker is a delivery it sends, and the walk waits for it.
      DEEVY_HOSTED_PASS_SECONDS: "1",
    },
  });
  const persistTo = await mkdtemp(join(tmpdir(), "deevy-acceptance-hosted-"));
  const child = await startLocal(files, { port, persistTo });
  try {
    const { url } = await platform<{ url: string }>(host, "provision", {
      slug: "acme",
      name: "Acme",
      adminEmail,
    });
    return {
      name: "hosted",
      origin: url,
      // Nothing: the Workspace's alarm is the tick here, every second.
      tick: () => Promise.resolve(),
      stop: () => child.kill("SIGTERM"),
    };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

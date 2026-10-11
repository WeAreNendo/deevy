/**
 * The hosted Worker on this machine: built with the version it is, configured
 * for `wrangler dev --local` beside a stand-in for the console
 * (scripts/console-stub.js), started, and called the way the console calls it.
 * scripts/smoke-hosted.ts runs two Workspaces on it, and the acceptance walk
 * (apps/agent/scripts/boot.ts) works a record through one.
 *
 * The configuration it runs is the one a release ships (scripts/artifact.ts)
 * with the deployer's blanks filled locally, so what is tested here is the
 * shape that is deployed rather than a second copy of it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bundledConfig } from "./artifact.ts";

export const app = join(new URL(".", import.meta.url).pathname, "..");
export const wrangler = join(app, "node_modules/.bin/wrangler");
const dist = join(app, "dist/hosted");
const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

export function run(
  command: string,
  args: string[],
  cwd = app,
  extra: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...childEnv, ...extra } });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`)),
    );
  });
}

/** deevy's version: every package carries the same one (a fixed group in .changeset/config.json). */
export async function version(): Promise<string> {
  return (JSON.parse(await readFile(join(app, "package.json"), "utf8")) as { version: string })
    .version;
}

/**
 * `dist/hosted/worker.js`, bundled by wrangler from wrangler.jsonc, with the
 * version it is written in: what a Workspace reports to `Platform.status`.
 * The SPA it serves is apps/web's, built first by `vp run web#build:workers`.
 */
export async function buildHosted(): Promise<void> {
  const define = `__DEEVY_VERSION__:${JSON.stringify(await version())}`;
  await run(wrangler, [
    "deploy",
    "--dry-run",
    "--config",
    "wrangler.jsonc",
    "--outdir",
    "dist/hosted",
    "--define",
    define,
  ]);
}

export interface LocalOptions {
  /** Names the files written beside the bundle, so the smoke and the walk never share them. */
  label: string;
  /** What `DEEVY_HOSTED_ORIGIN` says: a loopback origin, the only one the stubs run on. */
  origin: string;
  /** Variables over the platform's local ones: a stub tracker's containers, a faster alarm. */
  vars?: Record<string, string>;
}

/**
 * The built bundle with the providers' OAuth endpoints stubbed — the Worker
 * smoke's trick, apps/web/scripts/stub-oauth.js prepended — and the two
 * configurations `wrangler dev` runs: the hosted Worker's, and the console's.
 */
export async function localConfigs({
  label,
  origin,
  vars = {},
}: LocalOptions): Promise<{ hosted: string; console: string }> {
  const bundle = join(dist, "worker.js");
  if (!existsSync(bundle)) {
    throw new Error(
      "No hosted Worker to run: build it with `vp run web#build:workers && vp run hosted#build:hosted`",
    );
  }
  const [oauth, source, committed] = await Promise.all([
    readFile(join(app, "../web/scripts/stub-oauth.js"), "utf8"),
    readFile(bundle, "utf8"),
    readFile(join(app, "wrangler.jsonc"), "utf8"),
  ]);
  const main = `worker.${label}.js`;
  await writeFile(join(dist, main), `${oauth}\n${source}`);
  const shipped = bundledConfig(committed);
  const consoleName = `deevy-console-${label}`;

  const hosted = join(dist, `wrangler.${label}.json`);
  await writeFile(
    hosted,
    JSON.stringify({
      ...shipped,
      main,
      assets: { ...shipped.assets, directory: join(app, "../web/dist/client") },
      kv_namespaces: [{ binding: "DIRECTORY", id: `${label}-directory` }],
      services: [{ binding: "CONSOLE", service: consoleName }],
      vars: {
        ...shipped.vars,
        DEEVY_HOSTED_ORIGIN: origin,
        DEEVY_HOSTED_MASTER_SECRET: "local-master-secret-local-master-secret-12345",
        // workerd does not implement jurisdictions ("not implemented in
        // workerd"), so locally every object is created without one; a
        // deployment's `eu` is Cloudflare's to enforce (wrangler.jsonc).
        DEEVY_HOSTED_JURISDICTION: "",
        DEEVY_SIGN_IN_RELAY_SECRET: "local-relay-secret-local-relay-secret-123456",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        ...vars,
      },
    }),
  );
  const consoleConfig = join(dist, `wrangler.console-${label}.json`);
  await writeFile(
    consoleConfig,
    JSON.stringify({
      name: consoleName,
      main: join(app, "scripts/console-stub.js"),
      compatibility_date: shipped.compatibility_date,
      services: [{ binding: "PLATFORM", service: shipped.name, entrypoint: "Platform" }],
    }),
  );
  return { hosted, console: consoleConfig };
}

/** Both Workers in one `wrangler dev --local`, once it says it is ready. */
export function startLocal(
  files: { hosted: string; console: string },
  { port, persistTo }: { port: number; persistTo: string },
): Promise<ChildProcess> {
  const child = spawn(
    wrangler,
    ["dev", "--local", "-c", files.hosted, "-c", files.console, "--persist-to", persistTo].concat([
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ]),
    { cwd: app, stdio: ["ignore", "pipe", "pipe"], env: childEnv },
  );
  return new Promise<ChildProcess>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`wrangler dev was not ready in 90s:\n${output}`));
    }, 90_000);
    // Read for as long as it runs, so a full pipe never stalls it.
    const watch = (chunk: Buffer) => {
      output += chunk.toString();
      if (/Ready on https?:\/\//.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`wrangler dev exited ${String(code)}:\n${output}`));
    });
  });
}

/** One call to `Platform`, through the stand-in console, as the real one makes it. */
export async function platform<T>(origin: string, method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`${origin}/console/platform/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) throw new Error(`Platform.${method}: ${body.error ?? response.status}`);
  return body.result as T;
}

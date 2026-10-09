/**
 * The previous release, on this tree's schema (ADR-0031).
 *
 * A gradual deploy runs two releases on one database at once, and a rollback
 * runs the older one on whatever the newer one migrated. `db#check:migrations`
 * refuses the statements that would break that; this runs the claim itself:
 *
 * 1. The previous release is the newest `v*` tag behind HEAD — the one before
 *    HEAD's own when HEAD is a release, because a release is not its own
 *    previous one — or `DEEVY_PREVIOUS_TAG`.
 * 2. That tag's server is built from `git archive`, the way its image was:
 *    `vp install --frozen-lockfile`, then `vp run server#build`. Once per tag,
 *    kept in node_modules/.cache/deevy-previous, since a tag does not change.
 * 3. This tree's server migrates a new database, a Human signs in through the
 *    OAuth stub (which makes the Workspace) and creates an Agent.
 * 4. The previous release starts on that file. Its migrator finds migrations it
 *    has no folder for, and must start anyway; then it signs the same Human
 *    in, reads over /rpc as the SPA does, and creates an Agent of its own.
 * 5. This tree starts again on what the previous release wrote: the roll
 *    forward after the rollback.
 * 6. Every contraction names an expansion the previous release carried.
 *
 *     vp run server#test:previous
 *     DEEVY_PREVIOUS_TAG=v0.9.0 vp run server#test:previous
 *
 * The Docker image of the previous release would do for step 2, and was the
 * other way to do it: but it needs a daemon, a pull and a volume this script
 * would have to share with the host, where a build from the tag needs the
 * toolchain every checkout already has and runs the same on a laptop.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { checkExpandOnly } from "../../../packages/db/scripts/expand-only.ts";

const run = promisify(execFile);
const root = new URL("../../../", import.meta.url).pathname;
const thisTree = join(root, "apps/server/dist");
const maxBuffer = 64 * 1024 * 1024;

/** `DEEVY_ADMIN_EMAIL`, whose first sign-in makes the Workspace. */
const adminEmail = "ada@example.com";
const secret = "previous-release-secret-previous-release-32";
const sealingSecret = "previous-release-sealing-previous-release-32";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): boolean {
  if (ok) console.log(`  ok  ${name}`);
  else {
    console.log(`  NOT ${name}`);
    failures.push(detail ? `${name}:\n${indent(detail)}` : name);
  }
  return ok;
}

function indent(text: string): string {
  return text
    .trim()
    .split("\n")
    .slice(-40)
    .map((line) => `    ${line}`)
    .join("\n");
}

async function git(...args: string[]): Promise<string> {
  return (await run("git", args, { cwd: root, maxBuffer })).stdout.trim();
}

async function previousRelease(): Promise<string> {
  const named = process.env.DEEVY_PREVIOUS_TAG?.trim();
  if (named) return named;
  const here = await git("tag", "--points-at", "HEAD", "--list", "v*");
  try {
    return await git("describe", "--tags", "--abbrev=0", "--match", "v*", here ? "HEAD^" : "HEAD");
  } catch (error) {
    throw new Error(
      "no v* tag behind HEAD. A shallow clone has none: `git fetch --tags --unshallow`, " +
        "or name the release with DEEVY_PREVIOUS_TAG",
      { cause: error },
    );
  }
}

/** The tag's `apps/server/dist`, built from the tag's own tree and lockfile. */
async function buildRelease(tag: string): Promise<string> {
  const dist = join(root, "node_modules/.cache/deevy-previous", tag);
  if (existsSync(join(dist, "index.mjs"))) {
    console.log(`${tag}: built before, in ${relative(root, dist)}`);
    return dist;
  }
  const started = Date.now();
  const source = await mkdtemp(join(tmpdir(), `deevy-${tag}-`));
  // The tag's own tooling, not this checkout's: its lockfile, its Vite+, its
  // pack configuration. Husky has no .git to install hooks into here.
  const env = { ...process.env, HUSKY: "0", CI: "1" };
  try {
    const archive = join(source, "source.tar");
    await git("archive", "--format=tar", "-o", archive, tag);
    await run("tar", ["-xf", archive, "-C", source]);
    await rm(archive);
    await run("vp", ["install", "--frozen-lockfile"], { cwd: source, env, maxBuffer });
    await run("vp", ["run", "server#build"], { cwd: source, env, maxBuffer });
    await cp(join(source, "apps/server/dist"), dist, { recursive: true });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `could not build ${tag}: ${failed.message ?? ""}\n${failed.stdout ?? ""}${failed.stderr ?? ""}`,
      { cause: error },
    );
  } finally {
    await rm(source, { recursive: true, force: true });
  }
  console.log(`${tag}: built in ${String(Math.round((Date.now() - started) / 1000))}s`);
  return dist;
}

/** A port nothing is on, taken and released, so the sign-in origin can be named up front. */
function freePort(): Promise<number> {
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

interface Running {
  origin: string;
  output(): string;
  stop(): Promise<void>;
}

/**
 * One build of the Node server on `database`, answering /healthz, or null
 * with its output recorded. Its environment is only what is named here, so a
 * developer's shell cannot configure a provider or a sender into the walk.
 */
async function start(name: string, dist: string, database: string): Promise<Running | null> {
  const port = await freePort();
  const origin = `http://localhost:${String(port)}`;
  let output = "";
  const child = spawn(process.execPath, [join(dist, "index.mjs")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      DEEVY_PORT: String(port),
      DEEVY_DATABASE_PATH: database,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: secret,
      DEEVY_SECRET: sealingSecret,
      DEEVY_ADMIN_EMAIL: adminEmail,
      DEEVY_DEV_STUB_OAUTH: "1",
    },
  });
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.on("exit", () => {
      exited = true;
      resolve();
    }),
  );
  const stop = async () => {
    if (!exited) child.kill("SIGTERM");
    await exit;
  };

  for (let i = 0; i < 60 && !exited; i += 1) {
    const answer = await fetch(`${origin}/healthz`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ok?: boolean }>) : null))
      .catch(() => null);
    if (answer?.ok === true) {
      check(`${name} starts and answers /healthz`, true);
      return { origin, output: () => output, stop };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await stop();
  check(`${name} starts and answers /healthz`, false, output);
  return null;
}

/** Every cookie a response set, as one request header. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * One Human signing in with GitHub through the stub, as a browser would: the
 * authorization URL, then the callback with its state and the code, which the
 * stub reads as the email address (apps/web/scripts/stub-oauth.js).
 */
async function signIn(origin: string, email: string): Promise<string> {
  const started = await fetch(`${origin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/" }),
  });
  const { url } = (await started.json().catch(() => ({}))) as { url?: string };
  if (!url) return "";
  const state = new URL(url).searchParams.get("state") ?? "";
  const callback = await fetch(
    `${origin}/api/auth/callback/github?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(started) }, redirect: "manual" },
  );
  return cookiesOf(callback);
}

/** One oRPC call over /rpc, as the SPA makes it. */
async function rpc<T>(
  origin: string,
  procedure: string,
  input: unknown,
  cookie: string,
): Promise<{ status: number; output: T | null; body: string }> {
  const response = await fetch(`${origin}/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ json: input }),
  });
  const body = await response.text();
  let output: T | null = null;
  try {
    output = (JSON.parse(body) as { json?: T }).json ?? null;
  } catch {
    output = null;
  }
  return { status: response.status, output, body };
}

interface Agents {
  agents: Array<{ user: { name: string } }>;
}

async function agentNames(origin: string, cookie: string): Promise<string[]> {
  const listed = await rpc<Agents>(origin, "agents/list", {}, cookie);
  return listed.output?.agents.map((agent) => agent.user.name) ?? [];
}

/** What `__drizzle_migrations` holds, read with nothing else open on the file. */
function appliedMigrations(database: string): string[] {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare("SELECT name FROM __drizzle_migrations ORDER BY id").all();
    return rows.map((row) => String(row.name));
  } finally {
    db.close();
  }
}

async function smoke(): Promise<void> {
  const tag = await previousRelease();
  console.log(`the previous release is ${tag}`);
  const previous = await buildRelease(tag);
  const carried = new Set(
    (await git("ls-tree", "--name-only", `${tag}:packages/db/drizzle`)).split("\n").filter(Boolean),
  );

  const data = await mkdtemp(join(tmpdir(), "deevy-previous-"));
  const database = join(data, "deevy.sqlite");
  try {
    console.log("\nthis tree, on a new database:");
    const first = await start("this tree", thisTree, database);
    if (!first) return;
    try {
      const cookie = await signIn(first.origin, adminEmail);
      if (!check("signs the first Human in, which makes the Workspace", cookie !== "")) return;
      const created = await rpc(first.origin, "agents/create", { name: "Made here" }, cookie);
      check("creates an Agent", created.status === 200, created.body);
    } finally {
      await first.stop();
    }
    const migrated = appliedMigrations(database);
    const unknown = migrated.filter((name) => !carried.has(name));
    console.log(
      unknown.length > 0
        ? `  ..  ${String(unknown.length)} migration(s) ${tag} does not have: ${unknown.join(", ")}`
        : `  ..  no migration ${tag} does not have: the schema is the same`,
    );

    console.log(`\n${tag}, on this tree's schema:`);
    const older = await start(tag, previous, database);
    if (!older) return;
    try {
      const cookie = await signIn(older.origin, adminEmail);
      if (!check(`${tag} signs the same Human in`, cookie !== "", older.output())) return;
      const reads = await Promise.all(
        [
          ["workspace/get", {}],
          ["members/list", {}],
          ["runs/list", {}],
          ["inbox/list", {}],
        ].map(async ([procedure, input]) => ({
          procedure: procedure as string,
          ...(await rpc(older.origin, procedure as string, input, cookie)),
        })),
      );
      const failed = reads.filter((read) => read.status !== 200);
      check(
        `${tag} reads the Workspace, its Members, its Runs and the inbox`,
        failed.length === 0,
        failed.map((read) => `${read.procedure}: ${String(read.status)} ${read.body}`).join("\n"),
      );
      const names = await agentNames(older.origin, cookie);
      check(`${tag} lists the Agent this tree made`, names.includes("Made here"), names.join(", "));
      const created = await rpc(older.origin, "agents/create", { name: `Made by ${tag}` }, cookie);
      check(`${tag} creates an Agent of its own`, created.status === 200, created.body);
    } finally {
      await older.stop();
    }
    const after = appliedMigrations(database);
    check(
      `${tag} applied no migration and removed none`,
      JSON.stringify(after) === JSON.stringify(migrated),
      `before: ${migrated.join(", ")}\nafter: ${after.join(", ")}`,
    );

    console.log(`\nthis tree again, after the rollback:`);
    const again = await start("this tree", thisTree, database);
    if (!again) return;
    try {
      const cookie = await signIn(again.origin, adminEmail);
      const names = await agentNames(again.origin, cookie);
      check(
        `reads both Agents, the one ${tag} made included`,
        names.includes("Made here") && names.includes(`Made by ${tag}`),
        names.join(", ") || again.output(),
      );
    } finally {
      await again.stop();
    }
  } finally {
    await rm(data, { recursive: true, force: true });
  }

  console.log(`\nwhat this tree removes:`);
  const contractions = await checkExpandOnly(join(root, "packages/db/drizzle"), {
    shipped: { release: tag, migrations: carried },
  });
  check(
    `every contraction names an expansion ${tag} carried`,
    contractions.length === 0,
    contractions.join("\n"),
  );
}

if (import.meta.main) {
  try {
    await smoke();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (failures.length > 0) {
    console.error(
      `\nthe previous release does not run on this schema:\n${failures.map((f) => `  ${f}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("\nthe previous release runs on this schema");
}

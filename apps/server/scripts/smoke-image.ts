/**
 * Runs the deevy image and asks it the questions an operator's first hour asks
 * (docs/OPERATIONS.md, "The image").
 *
 * It is a script rather than a vitest file for the reason
 * apps/web/scripts/smoke-workers.ts and packages/db/scripts/check-d1-apply.ts
 * are: its input is a Docker daemon, which is neither jsdom nor the Node test
 * environment, and what it tests is the shipped shape — the user the process
 * runs as, what the volume ends up owned by, whether the image can say it is
 * well — which no unit test of anything inside the bundle can see.
 *
 * This used to be twelve lines of bash in the `images` job, which meant a
 * change to apps/server/Dockerfile could only be tested by pushing. Everything
 * here runs the same way on a laptop:
 *
 *     vp run server#test:image                 builds deevy:smoke if it is absent
 *     DEEVY_IMAGE=deevy:ci vp run server#test:image   an image already built
 *
 * The image reads nothing from the workspace, so this file imports node:
 * builtins only and needs no install to run — which is what lets CI call it
 * with nothing but a Node on PATH.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("../../../", import.meta.url).pathname;
const image = process.env.DEEVY_IMAGE ?? "deevy:smoke";
/** Named so a crashed run never wedges the next one, and never collides with CI's own `deevy`. */
const tag = randomBytes(4).toString("hex");
const container = `deevy-smoke-${tag}`;
const volume = `deevy-smoke-${tag}`;

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else failures.push(detail ? `${name}: ${detail}` : name);
}

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

/** Exit code and output, for the checks whose answer is "this must not work". */
async function attempt(...args: string[]): Promise<{ code: number; output: string }> {
  try {
    return { code: 0, output: await docker(...args) };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failed.code ?? 1,
      output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`.trim(),
    };
  }
}

/**
 * Reading the volume needs a container, because the deevy image has no shell to
 * read it with — which is the point, and is why every ownership check here goes
 * through a sidecar the way docs/OPERATIONS.md's backup recipe does.
 */
async function onTheVolume(...command: string[]): Promise<{ code: number; output: string }> {
  return attempt("run", "--rm", "-v", `${volume}:/data`, "busybox", ...command);
}

async function ensureImage(): Promise<void> {
  const present = await attempt("image", "inspect", image);
  if (present.code === 0) return;
  console.log(`building ${image}`);
  await docker("build", "-f", "apps/server/Dockerfile", "-t", image, root);
}

/** The port Docker chose for us. Asking for 0 and reading it back has no bind race. */
async function publishedPort(): Promise<number> {
  const mapping = await docker("port", container, "3000/tcp");
  const port = Number(mapping.split("\n")[0]?.split(":").pop());
  if (!Number.isInteger(port) || port <= 0) throw new Error(`no published port in "${mapping}"`);
  return port;
}

async function healthy(origin: string, seconds = 60): Promise<boolean> {
  for (let i = 0; i < seconds; i += 1) {
    const answer = await fetch(`${origin}/healthz`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if ((answer as { ok?: boolean } | null)?.ok === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function start(): Promise<string> {
  await docker(
    "run",
    "-d",
    "--name",
    container,
    "-p",
    "0:3000",
    "-v",
    `${volume}:/data`,
    "-e",
    "BETTER_AUTH_SECRET=smoke-secret-that-is-at-least-32-characters",
    "-e",
    "BETTER_AUTH_URL=http://localhost:3000",
    "-e",
    "DEEVY_ADMIN_EMAIL=admin@example.com",
    image,
  );
  return `http://127.0.0.1:${String(await publishedPort())}`;
}

/** What the image says about itself, before anything is run. */
export function imageInvariants(config: {
  User?: string;
  Entrypoint?: string[] | null;
  Cmd?: string[] | null;
}): string[] {
  const problems: string[] = [];
  if (config.User !== "65532:65532")
    problems.push(`it runs as "${config.User ?? ""}" and not 65532:65532`);
  // The entrypoint is the interpreter, so the command is the script alone —
  // `["node", …]` here would run `node node dist/index.mjs`.
  if (JSON.stringify(config.Entrypoint) !== JSON.stringify(["/nodejs/bin/node"]))
    problems.push(`its entrypoint is ${JSON.stringify(config.Entrypoint)}`);
  if (JSON.stringify(config.Cmd) !== JSON.stringify(["dist/index.mjs"]))
    problems.push(`its command is ${JSON.stringify(config.Cmd)}`);
  return problems;
}

async function smoke(): Promise<void> {
  await ensureImage();

  const config = JSON.parse(await docker("image", "inspect", "-f", "{{json .Config}}", image));
  const problems = imageInvariants(config);
  check("it is configured the way the Dockerfile says", problems.length === 0, problems.join("; "));

  // Asked of the image rather than read off the base tag, because "distroless"
  // is a claim about what is in it and not about what it is called.
  const shell = await attempt("run", "--rm", "--entrypoint", "/bin/sh", image, "-c", "true");
  check("it has no shell for anything that gets in to use", shell.code !== 0, shell.output);

  await docker("volume", "create", volume);

  const origin = await start();

  // Migrations run before the listener binds (apps/server/src/server.ts), so an
  // answer here is also the migrations having applied to an empty volume.
  const up = await healthy(origin);
  check("it serves /healthz on a fresh volume", up, await logs());
  if (!up) return;

  check("the SPA is served beside the API", (await fetch(origin).then((r) => r.status)) === 200);

  // `docker top` prints the numeric uid when the host has no user by that id,
  // which is the answer wanted: what the kernel sees, not what the image said.
  // `pid` has to be asked for: the daemon looks for it in the ps output and
  // refuses the call without it, whatever the other columns say.
  const processes = await attempt("top", container, "-o", "pid,user");
  check("the process really is unprivileged", /\b65532\b/.test(processes.output), processes.output);

  // The image says it is well, which is the mechanism compose's
  // `depends_on: condition: service_healthy` waits on — and it has to do it
  // with no shell and with /nodejs/bin off the PATH.
  check(
    "it reports its own health",
    await reportsHealthy(),
    await health("{{if .State.Health}}{{json .State.Health}}{{else}}no HEALTHCHECK{{end}}"),
  );

  const listing = await onTheVolume("ls", "/data");
  const files = listing.output.split(/\s+/);
  check("the database is on the volume", files.includes("deevy.sqlite"), listing.output);

  const owner = await onTheVolume("stat", "-c", "%u %g %n", "/data/deevy.sqlite");
  check("it wrote the database as itself", owner.output.startsWith("65532 65532 "), owner.output);
  // SQLite does not fail a `PRAGMA journal_mode` it cannot honour, it silently
  // stays in `delete` mode — so a /data deevy can read but not write would pass
  // every check above and quietly run without WAL. The -shm is the artefact
  // that says the pragma took (packages/adapters/src/node/db.ts).
  check(
    "WAL is on, so the directory is really writable",
    files.includes("deevy.sqlite-shm"),
    listing.output,
  );

  await docker("stop", container);
  await docker("start", container);
  check(
    "it comes back up on the volume it wrote",
    await healthy(`http://127.0.0.1:${String(await publishedPort())}`),
    await logs(),
  );
}

async function health(template: string): Promise<string> {
  return (await attempt("inspect", "-f", template, container)).output;
}

/** Health has a start period, so this waits rather than asking once. */
async function reportsHealthy(seconds = 90): Promise<boolean> {
  for (let i = 0; i < seconds; i += 1) {
    // Guarded, because a container from an image with no HEALTHCHECK has no
    // `.State.Health` key at all and the template errors rather than answering.
    const status = await health("{{if .State.Health}}{{.State.Health.Status}}{{end}}");
    if (status === "healthy") return true;
    if (status === "unhealthy" || status === "") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function logs(): Promise<string> {
  return (await attempt("logs", "--tail", "40", container)).output;
}

if (import.meta.main) {
  console.log(`smoking ${image}`);
  try {
    await smoke();
  } finally {
    await attempt("rm", "-f", container);
    await attempt("volume", "rm", "-f", volume);
  }
  if (failures.length > 0) {
    console.error(`\nthe image did not run deevy:\n${failures.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nthe image runs deevy");
}

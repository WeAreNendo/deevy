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
async function publishedPort(name = container): Promise<number> {
  const mapping = await docker("port", name, "3000/tcp");
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

const env = [
  "-e",
  "BETTER_AUTH_SECRET=smoke-secret-that-is-at-least-32-characters",
  "-e",
  "BETTER_AUTH_URL=http://localhost:3000",
  "-e",
  "DEEVY_ADMIN_EMAIL=admin@example.com",
];

async function start(name = container, on = volume): Promise<string> {
  await docker("run", "-d", "--name", name, "-p", "0:3000", "-v", `${on}:/data`, ...env, image);
  return `http://127.0.0.1:${String(await publishedPort(name))}`;
}

/**
 * Who the server process is, as the kernel sees it: the row of `docker top`
 * whose pid is the container's own. That row and not every row, because a
 * healthcheck in flight is a second process, and it runs as the image's user.
 */
async function serverUser(name = container): Promise<string> {
  const pid = await docker("inspect", "-f", "{{.State.Pid}}", name);
  // `uid` rather than `user`, which prints a name when the host has a user by
  // that id: what the kernel sees, not what the image said. `pid` has to be
  // asked for: the daemon looks for it in the ps output and refuses the call
  // without it, whatever the other columns say.
  const processes = await attempt("top", name, "-o", "pid,uid");
  const row = processes.output.split("\n").find((line) => line.trim().split(/\s+/)[0] === pid);
  return row?.trim().split(/\s+/)[1] ?? `no process ${pid} in:\n${processes.output}`;
}

/** What the image says about itself, before anything is run. */
export function imageInvariants(config: {
  User?: string;
  Entrypoint?: string[] | null;
  Cmd?: string[] | null;
}): string[] {
  const problems: string[] = [];
  // Root on purpose, until the entrypoint has given /data away (ADR-0033).
  if (config.User !== "0:0") problems.push(`it starts as "${config.User ?? ""}" and not 0:0`);
  // Everything goes through the entrypoint, which drops root before it
  // imports the script it is handed — so the command is the script alone.
  if (
    JSON.stringify(config.Entrypoint) !==
    JSON.stringify(["/nodejs/bin/node", "/app/dist/entrypoint.mjs"])
  )
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

  // The entrypoint runs as root at every start, so whoever could change the
  // code could change what root runs next. `COPY --from` keeps the build
  // stage's owner, vp's 1000, unless the Dockerfile says otherwise.
  const writable = await inTheImage(`
    const { lstatSync, readdirSync } = require("node:fs");
    const walk = (p) => {
      const s = lstatSync(p);
      const bad = s.uid !== 0 || s.gid !== 0 || (s.mode & 0o022) !== 0 ? [p + " " + s.uid + ":" + s.gid + " " + (s.mode & 0o777).toString(8)] : [];
      return s.isDirectory() ? bad.concat(...readdirSync(p).map((n) => walk(p + "/" + n))) : bad;
    };
    console.log(walk("/app").join("\\n"));`);
  check(
    "its code is root's and nobody else may change it",
    writable.code === 0 && writable.output === "",
    writable.output,
  );

  // Everything the entrypoint imports statically is evaluated as root, before
  // the drop: Node's own modules, and nothing of the server's (ownership.ts is
  // inlined). A literal `import("…")` would be too, once reached; the one that
  // imports the script is not a literal and runs after the drop.
  const imports = await inTheImage(`
    const source = require("node:fs").readFileSync("/app/dist/entrypoint.mjs", "utf8");
    const named = [...source.matchAll(/(?:^\\s*(?:import|export)\\b[^;]*?|\\bimport\\s*\\(\\s*)["']([^"']+)["']/gm)].map((m) => m[1]);
    console.log(named.length === 0 ? "no imports found" : named.filter((name) => !name.startsWith("node:")).join(" "));`);
  check(
    "its entrypoint loads nothing but Node's own modules as root",
    imports.code === 0 && imports.output === "",
    imports.output,
  );

  await docker("volume", "create", volume);

  const origin = await start();

  // Migrations run before the listener binds (apps/server/src/server.ts), so an
  // answer here is also the migrations having applied to an empty volume.
  const up = await healthy(origin);
  check("it serves /healthz on a fresh volume", up, await logs());
  if (!up) return;

  check("the SPA is served beside the API", (await fetch(origin).then((r) => r.status)) === 200);

  const user = await serverUser();
  check("the server gave up root for 65532", user === "65532", user);

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

  // Stopped first, so that the copies the cases below take of its database
  // are of a database nothing is writing.
  await docker("stop", container);
  await takesAVolumeRootWrote();
  await takesADirectorySomebodyElseOwns();
  await refusesWhatAnotherUserCannotWrite();
  await runsTheScriptItIsHanded();

  await docker("start", container);
  check(
    "it comes back up on the volume it wrote",
    await healthy(`http://127.0.0.1:${String(await publishedPort())}`),
    await logs(),
  );
}

/** A volume of its own, filled by a sidecar as root from the one the run made. */
async function volumeWith(suffix: string, script: string): Promise<string> {
  const other = `${volume}-${suffix}`;
  await docker("volume", "create", other);
  await attempt(
    "run",
    "--rm",
    "-v",
    `${volume}:/from`,
    "-v",
    `${other}:/data`,
    "busybox",
    "sh",
    "-c",
    script,
  );
  return other;
}

/** Node in the image itself, which has nothing else to ask it with. */
async function inTheImage(script: string): Promise<{ code: number; output: string }> {
  return attempt("run", "--rm", "--entrypoint", "/nodejs/bin/node", image, "-e", script);
}

async function ownerOn(on: string, path: string): Promise<string> {
  const stat = ["stat", "-c", "%u:%g", path];
  return (await attempt("run", "--rm", "-v", `${on}:/data`, "busybox", ...stat)).output;
}

/**
 * A volume every file of which belongs to root: what releases before 0.8 left,
 * and what a restore from a root sidecar leaves of the database. It was once
 * the worst case there is — deevy applied no migrations, answered /healthz,
 * reported healthy and failed at the first write — and then a refusal naming a
 * chown. Now the entrypoint gives it to 65532 before the server opens it.
 */
async function takesAVolumeRootWrote(): Promise<void> {
  const stale = await volumeWith("stale", "cp /from/deevy.sqlite /data/ && chown -R 0:0 /data");
  const name = `${container}-stale`;
  try {
    const up = await healthy(await start(name, stale));
    check("it starts on a volume root wrote", up, await logs(name));
    const dir = await ownerOn(stale, "/data");
    check("and gives the directory to 65532", dir === "65532:65532", dir);
    const owner = await ownerOn(stale, "/data/deevy.sqlite");
    check("and the database", owner === "65532:65532", owner);
    const user = await serverUser(name);
    check("then runs as 65532", user === "65532", user);
  } finally {
    await attempt("rm", "-f", name);
    await attempt("volume", "rm", "-f", stale);
  }
}

/**
 * A host directory somebody made, played by a volume whose root is theirs:
 * the same code path, without the ownership Docker Desktop makes up for a bind
 * mount. deevy gives it to 65532 and runs as 65532, never as them: a container
 * escape as its owner would be a real user on the host (ADR-0033).
 *
 * Something has to be in it: Docker copies the image's /data, ownership and
 * all, into a named volume that is empty when it is mounted, which would make
 * this 65532's before deevy saw it. A host directory has no such step. A file
 * of root's serves, and says whether anything else in the directory is touched.
 */
async function takesADirectorySomebodyElseOwns(): Promise<void> {
  const theirs = await volumeWith("theirs", "touch /data/notes.txt && chown 4321:4321 /data");
  const name = `${container}-theirs`;
  try {
    const up = await healthy(await start(name, theirs));
    check("it starts on a directory somebody else owns", up, await logs(name));
    const user = await serverUser(name);
    check("and runs as 65532 rather than as them", user === "65532", user);
    const dir = await ownerOn(theirs, "/data");
    check("and gives the directory to 65532", dir === "65532:65532", dir);
    const owner = await ownerOn(theirs, "/data/deevy.sqlite");
    check("and writes the database as 65532", owner === "65532:65532", owner);
    const notes = await ownerOn(theirs, "/data/notes.txt");
    check("and leaves the rest of the directory alone", notes === "0:0", notes);
  } finally {
    await attempt("rm", "-f", name);
    await attempt("volume", "rm", "-f", theirs);
  }
}

/**
 * `--user` keeps the image from ever being root, and so from giving anything
 * away: on a volume that user cannot write, deevy must refuse to start rather
 * than look well, and say what fixes it.
 */
async function refusesWhatAnotherUserCannotWrite(): Promise<void> {
  const as = ["--user", "4242:4242"];
  const refused = await attempt("run", "--rm", "-v", `${volume}:/data`, ...env, ...as, image);
  check(
    "it refuses a volume --user cannot write rather than looking well",
    refused.code !== 0,
    refused.output,
  );
  check(
    "and names the command that fixes it",
    /chown -R 4242:4242/.test(refused.output),
    refused.output,
  );
}

/** `docker run … dist/import.mjs` goes through the entrypoint too, and keeps its arguments. */
async function runsTheScriptItIsHanded(): Promise<void> {
  const help = await attempt("run", "--rm", image, "dist/import.mjs", "--help");
  check(
    "it runs the script it is handed, with its arguments",
    help.code === 0 && help.output.includes("Usage:"),
    help.output,
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

async function logs(name = container): Promise<string> {
  return (await attempt("logs", "--tail", "40", name)).output;
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

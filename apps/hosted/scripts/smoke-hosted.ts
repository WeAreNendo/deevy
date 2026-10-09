/**
 * The many-Workspaces Worker on workerd (docs/plans/hosted.md slice 9).
 *
 * `wrangler dev --local` runs the built hosted Worker — its router, its
 * Durable Objects with their SQLite, its KV directory, its assets — beside a
 * stand-in for the console (scripts/console-stub.js), each reaching the other
 * over a service binding as in production. The outside world is replaced only
 * where deevy calls it: a provider's OAuth endpoints, through
 * apps/web/scripts/stub-oauth.js prepended to the bundle, as the Worker smoke
 * does. Two Workspaces are provisioned through `Platform`, and the rest is what
 * a team would do: sign in through the relay, read their Workspace, invite
 * somebody, and never see the other team's — and what the console would: read
 * a Workspace's counts and give it a limit of its own.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = new URL(".", import.meta.url).pathname;
const app = join(here, "..");
const wrangler = join(app, "node_modules/.bin/wrangler");
const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else failures.push(detail ? `${name}: ${detail}` : name);
}

function run(
  command: string,
  args: string[],
  cwd = app,
  extra: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...childEnv, ...extra } });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`)),
    );
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** The built Worker with the providers' endpoints stubbed, and the two configurations wrangler dev runs. */
async function configs(port: number): Promise<{ hosted: string; console: string }> {
  const dist = join(app, "dist/hosted");
  const [oauth, bundle, source] = await Promise.all([
    readFile(join(app, "../web/scripts/stub-oauth.js"), "utf8"),
    readFile(join(dist, "worker.js"), "utf8"),
    readFile(join(app, "wrangler.jsonc"), "utf8"),
  ]);
  await writeFile(join(dist, "worker.smoke.js"), `${oauth}\n${bundle}`);
  const compatibility = JSON.parse(
    `{${/"compatibility_date":\s*"[^"]+"/.exec(source)?.[0] ?? ""}}`,
  ) as { compatibility_date: string };
  const hosted = join(dist, "wrangler.smoke.json");
  await writeFile(
    hosted,
    JSON.stringify({
      name: "deevy-hosted",
      main: "worker.smoke.js",
      no_bundle: true,
      rules: [{ type: "ESModule", globs: ["**/*.js"] }],
      compatibility_date: compatibility.compatibility_date,
      compatibility_flags: ["new_module_registry"],
      assets: {
        directory: join(app, "../web/dist/client"),
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: true,
      },
      durable_objects: { bindings: [{ name: "WORKSPACES", class_name: "WorkspaceObject" }] },
      migrations: [{ tag: "v1", new_sqlite_classes: ["WorkspaceObject"] }],
      kv_namespaces: [{ binding: "DIRECTORY", id: "smoke-directory" }],
      services: [{ binding: "CONSOLE", service: "deevy-console-stub" }],
      vars: {
        DEEVY_HOSTED_ORIGIN: `http://127.0.0.1:${String(port)}`,
        DEEVY_HOSTED_MASTER_SECRET: "smoke-master-secret-smoke-master-secret-1234",
        // workerd does not implement jurisdictions ("not implemented in
        // workerd"), so locally every object is created without one; a
        // deployment's `eu` is Cloudflare's to enforce (wrangler.jsonc).
        DEEVY_HOSTED_JURISDICTION: "",
        DEEVY_SIGN_IN_RELAY_SECRET: "smoke-relay-secret-smoke-relay-secret-12345",
        DEEVY_HOSTED_PASS_SECONDS: "2",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        DEEVY_DEV_STUB_EMAIL: "1",
      },
    }),
  );
  const consoleConfig = join(dist, "wrangler.console.json");
  await writeFile(
    consoleConfig,
    JSON.stringify({
      name: "deevy-console-stub",
      main: join(app, "scripts/console-stub.js"),
      compatibility_date: compatibility.compatibility_date,
      services: [{ binding: "PLATFORM", service: "deevy-hosted", entrypoint: "Platform" }],
    }),
  );
  return { hosted, console: consoleConfig };
}

function start(port: number, persistTo: string, files: { hosted: string; console: string }) {
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
    const watch = (chunk: Buffer) => {
      output += chunk.toString();
      if (/Ready on https?:\/\//.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`wrangler dev exited ${String(code)}:\n${output}`));
    });
  });
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function platform<T>(origin: string, method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`${origin}/console/platform/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) throw new Error(`Platform.${method}: ${body.error ?? response.status}`);
  return body.result as T;
}

async function rpc(url: string, procedure: string, input: unknown, cookie: string) {
  const response = await fetch(`${url}/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ json: input }),
  });
  const text = await response.text();
  let output: unknown = null;
  try {
    output = (JSON.parse(text) as { json?: unknown }).json;
  } catch {
    output = null;
  }
  return { status: response.status, output, text };
}

/** A Human signing in with GitHub at a Workspace, through the relay every App calls back to. */
async function signIn(origin: string, url: string, email: string) {
  const started = await fetch(`${url}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ provider: "github", callbackURL: `${url}/` }),
  });
  const { url: authorize } = (await started.json()) as { url: string };
  const authorization = new URL(authorize);
  const redirect = authorization.searchParams.get("redirect_uri") ?? "";
  // The provider sends the browser to the one callback it knows: the relay's.
  const relayed = await fetch(
    `${redirect}?code=${encodeURIComponent(email)}&state=${encodeURIComponent(authorization.searchParams.get("state") ?? "")}`,
    { redirect: "manual" },
  );
  const back = relayed.headers.get("location") ?? "";
  const finished = await fetch(back, {
    headers: { cookie: cookiesOf(started) },
    redirect: "manual",
  });
  return { redirect, back, finished, cookie: cookiesOf(finished) };
}

async function until(what: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await what()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function phases(origin: string): Promise<void> {
  check("/healthz answers", (await fetch(`${origin}/healthz`)).status === 200);
  check(
    "the root of the host is the console's",
    (await (await fetch(`${origin}/`)).text()) === "the console",
  );

  const acme = await platform<{ key: string; url: string }>(origin, "provision", {
    slug: "acme",
    name: "Acme",
    adminEmail: "ada@example.com",
  });
  const beta = await platform<{ key: string; url: string }>(origin, "provision", {
    slug: "beta",
    name: "Beta",
    adminEmail: "grace@example.com",
  });
  check("a Workspace is provisioned at its path", acme.url === `${origin}/acme`, acme.url);
  const taken = await platform<{ ok: boolean }>(origin, "available", "acme");
  check("a slug in use is not available again", taken.ok === false);
  check("a slug nobody holds is a 404", (await fetch(`${origin}/nobody/`)).status === 404);

  const page = await (await fetch(`${acme.url}/gates/gate_1`)).text();
  check("the SPA under a Workspace says where it lives", page.includes('<base href="/acme/" />'));
  const script = /src="\.\/(assets\/[^"]+\.js)"/.exec(page)?.[1];
  const asset = script ? await fetch(`${acme.url}/${script}`) : null;
  check("its assets are served under the path", asset?.status === 200, String(asset?.status));

  const discovered = await fetch(`${origin}/.well-known/oauth-authorization-server/acme`);
  const metadata = (await discovered.json().catch(() => ({}))) as { issuer?: string };
  check(
    "each Workspace is its own issuer, discovered by its path",
    metadata.issuer === acme.url,
    String(metadata.issuer),
  );

  const ada = await signIn(origin, acme.url, "ada@example.com");
  check(
    "every Workspace names the relay as its callback",
    ada.redirect === `${origin}/auth/callback/github`,
    ada.redirect,
  );
  check(
    "the relay sends the browser back to the Workspace",
    ada.back.startsWith(`${acme.url}/api/auth/callback/github?`),
    ada.back,
  );
  check(
    "the sign-in finishes at the Workspace, with a session for its path",
    ada.finished.headers
      .getSetCookie()
      .some((c) => c.includes("session_token=") && c.includes("Path=/acme")),
    String(ada.finished.status),
  );
  const grace = await signIn(origin, beta.url, "grace@example.com");

  const adaHere = await rpc(acme.url, "workspace/get", undefined, ada.cookie);
  check(
    "the admin's first sign-in made the Workspace, named as provisioned",
    adaHere.status === 200 && (adaHere.output as { name?: string } | null)?.name === "Acme",
    adaHere.text.slice(0, 200),
  );
  const adaThere = await rpc(beta.url, "workspace/get", undefined, ada.cookie);
  check(
    "a session of one Workspace is nobody in another",
    adaThere.status === 401,
    String(adaThere.status),
  );
  const members = await rpc(beta.url, "members/list", {}, grace.cookie);
  const names = JSON.stringify(members.output);
  check(
    "each Workspace holds its own Members",
    names.includes("grace@example.com") && !names.includes("ada@example.com"),
    names.slice(0, 200),
  );

  // A write owes an email; the Workspace's alarm sends it (no Cron, no queue).
  const invited = await rpc(
    acme.url,
    "invitations/create",
    { email: "lin@example.com", role: "member", send: true },
    ada.cookie,
  );
  check("an invitation is created", invited.status === 200, invited.text.slice(0, 200));
  const sent = await until(async () => {
    const list = await rpc(acme.url, "invitations/list", {}, ada.cookie);
    return JSON.stringify(list.output).includes('"emailStatus":"sent"');
  }, 20_000);
  check("the Workspace's alarm sends what a write owed", sent);

  type Status = {
    limits: { invitationsPerDay: number; emailsPerDay: number } | null;
    counts: {
      humans: number;
      invitationsToday: number;
      emailsToday: number;
      runsThisMonth: number;
    } | null;
    migrations: { error: unknown };
  };
  const status = await platform<Status>(origin, "status", "acme");
  check(
    "a Workspace reports itself to the platform",
    status.counts?.humans === 1 && status.migrations.error === null,
    JSON.stringify(status),
  );
  check(
    "and what it did today and this month, under the platform's limits",
    status.counts?.invitationsToday === 1 &&
      status.counts.emailsToday === 1 &&
      status.counts.runsThisMonth === 0 &&
      status.limits?.invitationsPerDay === 50,
    JSON.stringify(status),
  );

  // A Workspace's own limit, set over the platform's, holds at its next request.
  const limited = await platform<Status>(origin, "configure", "acme", {
    limits: { invitationsPerDay: 1 },
  });
  check(
    "Platform.configure gives a Workspace a limit of its own",
    limited.limits?.invitationsPerDay === 1 && limited.limits.emailsPerDay === 500,
    JSON.stringify(limited.limits),
  );
  const refused = await rpc(
    acme.url,
    "invitations/create",
    { email: "max@example.com", role: "member", send: false },
    ada.cookie,
  );
  check(
    "past its limit, the next invitation is refused, saying when it may be made",
    refused.status === 429 && refused.text.includes("You can invite somebody again"),
    `${String(refused.status)} ${refused.text.slice(0, 300)}`,
  );
  const givenBack = await platform<Status>(origin, "configure", "acme", {
    limits: { invitationsPerDay: null },
  });
  const allowed = await rpc(
    acme.url,
    "invitations/create",
    { email: "max@example.com", role: "member", send: false },
    ada.cookie,
  );
  check(
    "and given back to the platform's, it may invite again",
    givenBack.limits?.invitationsPerDay === 50 && allowed.status === 200,
    `${String(allowed.status)} ${allowed.text.slice(0, 200)}`,
  );

  const dump = await platform<string>(origin, "dump", "acme");
  const restored = new DatabaseSync(":memory:");
  restored.exec(dump);
  const rows = restored.prepare("SELECT name FROM workspace").all() as Array<{ name: string }>;
  const journal = restored.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
    n: number;
  };
  check(
    "a dump rebuilds the Workspace in a plain SQLite file",
    rows[0]?.name === "Acme" && journal.n > 0,
    JSON.stringify(rows),
  );

  await platform(origin, "suspend", "beta");
  check("a suspended Workspace answers nobody", (await fetch(`${beta.url}/`)).status === 403);
  await platform(origin, "resume", "beta");
  check("and answers again when resumed", (await fetch(`${beta.url}/`)).status === 200);
  await platform(origin, "destroy", "beta");
  check("a destroyed Workspace is gone", (await fetch(`${beta.url}/`)).status === 404);
  check(
    "and the other is untouched",
    (await rpc(acme.url, "workspace/get", undefined, ada.cookie)).status === 200,
  );
}

// The SPA every Workspace serves, as the Worker build makes it (apps/web).
await run(join(app, "../web/node_modules/.bin/vp"), ["build"], join(app, "../web"), {
  DEEVY_TARGET: "workers",
});
await run(wrangler, [
  "deploy",
  "--dry-run",
  "--config",
  "wrangler.jsonc",
  "--outdir",
  "dist/hosted",
]);
const port = await freePort();
const persistTo = await mkdtemp(join(tmpdir(), "deevy-hosted-"));
const files = await configs(port);
const server = await start(port, persistTo, files);
try {
  await phases(`http://127.0.0.1:${String(port)}`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  server.kill("SIGTERM");
  await rm(persistTo, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(
    `\nthe hosted Worker did not serve its Workspaces:\n${failures.map((f) => `  ${f}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("\nthe hosted Worker serves its Workspaces");

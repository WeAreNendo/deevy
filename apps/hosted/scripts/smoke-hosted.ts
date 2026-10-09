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
 * a Workspace's counts and give it a limit of its own. Then wrangler dev
 * starts again on the same storage with the alarm a minute apart, as in production, and a tab holds
 * the socket its Workspace pushes Events to while the object sleeps (ADR-0032).
 */
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, buildHosted, localConfigs, platform, run, startLocal, version } from "./local.ts";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else failures.push(detail ? `${name}: ${detail}` : name);
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

/** Stops wrangler dev and waits until it has, so its objects' storage is closed. */
function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
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

async function until(what: () => Promise<boolean>, ms: number, every = 500): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await what()) return true;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  return false;
}

/**
 * A tab's socket, opened as the SPA opens one (ADR-0032): at `/api/live` under
 * the Workspace, with whatever cookie and Origin a browser would send. Whether
 * the upgrade was taken, and every seq the object has said since.
 */
async function openTab(url: string, headers: Record<string, string>) {
  // Node's WebSocket is undici's, which takes headers a browser would set itself.
  const init = { headers } as unknown as string[];
  const socket = new WebSocket(`${url.replace(/^http/, "ws")}/api/live`, init);
  const heard: number[] = [];
  socket.addEventListener("message", (message) => {
    const data = String(message.data);
    if (!data.startsWith("{")) return;
    const { seq } = JSON.parse(data) as { seq?: unknown };
    if (typeof seq === "number") heard.push(seq);
  });
  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5_000);
    socket.addEventListener("open", () => (clearTimeout(timer), resolve(true)), { once: true });
    socket.addEventListener("close", () => (clearTimeout(timer), resolve(false)), { once: true });
  });
  return { socket, opened, heard };
}

/** What a streamed response says until `word` appears, or five seconds pass; then it is let go. */
async function firstOf(url: string, cookie: string, word: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  let said = "";
  try {
    const response = await fetch(url, { headers: { cookie }, signal: controller.signal });
    const reader = response.body?.getReader();
    while (reader && !said.includes(word)) {
      const { value, done } = await reader.read();
      if (done) break;
      said += new TextDecoder().decode(value);
    }
  } catch {
    // Five seconds without the word: what was said is the answer.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return said;
}

/** How long the object is left alone with a tab open, to see whether it sleeps. */
const IDLE_MS = 15_000;

/** Everything but the open tab; answers with Ada's session at acme, for `live`. */
async function phases(origin: string): Promise<string> {
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
    version: string | null;
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
    "and says which version it runs, as the build stamped it",
    status.version === (await version()),
    String(status.version),
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
  return ada.cookie;
}

/**
 * An open tab on a hosted Workspace (ADR-0032), run against the same
 * Workspaces after a restart with the pass at its production spacing: every
 * two seconds, as above, the alarm alone would keep the object from ever
 * sleeping. A socket the object pushes each new seq to, refused to whoever
 * `events.subscribe` would refuse, and kept open while the object sleeps.
 */
async function live(origin: string, cookie: string): Promise<void> {
  const acme = `${origin}/acme`;
  const ping = (await (await fetch(`${acme}/api/health/ping`)).json()) as { live?: string };
  check("a hosted Workspace offers its tabs a socket", ping.live === "websocket", ping.live);
  const stranger = await openTab(acme, { origin });
  check("a socket without a session is refused", !stranger.opened);
  const elsewhere = await openTab(acme, { origin: "https://elsewhere.example", cookie });
  check("a page on another origin cannot open one with its visitor's cookie", !elsewhere.opened);
  const tab = await openTab(acme, { origin, cookie });
  const told = await until(async () => tab.heard.length > 0, 5_000, 50);
  check(
    "a signed-in Human's socket opens and is told the head of the log",
    tab.opened && told,
    JSON.stringify(tab.heard),
  );

  const head = tab.heard.at(-1) ?? 0;
  const appended = Date.now();
  await rpc(acme, "invitations/create", { email: "bo@example.com", role: "member" }, cookie);
  const pushed = await until(async () => (tab.heard.at(-1) ?? 0) > head, 5_000, 50);
  check(
    "an Event appended reaches the open tab, pushed rather than polled",
    pushed,
    `heard ${JSON.stringify(tab.heard)}`,
  );
  if (pushed) console.log(`      (in ${String(Date.now() - appended)}ms)`);

  // Left alone with the tab open. The object is constructed again only if it
  // was put away in between, and asking for its status is what wakes it.
  const quiet = Date.now();
  await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  const slept = await platform<{ awakeSince: number; openTabs: number }>(origin, "status", "acme");
  check(
    "the object sleeps while the tab stays open",
    slept.awakeSince > quiet && slept.openTabs === 1,
    `awake since ${String(slept.awakeSince - quiet)}ms into the quiet, ${String(slept.openTabs)} tab(s)`,
  );
  const last = tab.heard.at(-1) ?? 0;
  await rpc(acme, "invitations/create", { email: "cy@example.com", role: "member" }, cookie);
  const again = await until(async () => (tab.heard.at(-1) ?? 0) > last, 5_000, 50);
  check("and wakes to push the next Event to it", again, JSON.stringify(tab.heard));

  // After the quiet, since an open stream is exactly what keeps an object up.
  const streamed = await firstOf(`${acme}/api/events/subscribe`, cookie, "heartbeat");
  check(
    "the stream still answers in the object, for a tab that cannot open a socket",
    streamed.includes("heartbeat"),
    streamed.slice(0, 200),
  );

  // The object's close frame is what counts; undici reports the socket closed
  // only once the connection under it is torn down, which locally is seconds later.
  await platform(origin, "suspend", "acme");
  const letGo = await until(async () => tab.socket.readyState >= WebSocket.CLOSING, 5_000, 50);
  check("a suspended Workspace lets its open tabs go", letGo, String(tab.socket.readyState));
}

// The SPA every Workspace serves, as the Worker build makes it (apps/web), and
// the hosted Worker around it, stamped with its version as a release is.
await run(join(app, "../web/node_modules/.bin/vp"), ["build"], join(app, "../web"), {
  DEEVY_TARGET: "workers",
});
await buildHosted();
const persistTo = await mkdtemp(join(tmpdir(), "deevy-hosted-"));
let server: ChildProcess | null = null;
try {
  // A pass every two seconds, so what a write owes goes out while the smoke waits.
  const port = await freePort();
  server = await startLocal(
    await localConfigs({
      label: "smoke",
      origin: `http://127.0.0.1:${String(port)}`,
      vars: { DEEVY_HOSTED_PASS_SECONDS: "2", DEEVY_DEV_STUB_EMAIL: "1" },
    }),
    { port, persistTo },
  );
  const cookie = await phases(`http://127.0.0.1:${String(port)}`);
  await stop(server);
  // The same Workspaces, kept in --persist-to, with the pass a minute apart.
  const again = await freePort();
  server = await startLocal(
    await localConfigs({
      label: "smoke",
      origin: `http://127.0.0.1:${String(again)}`,
      vars: { DEEVY_DEV_STUB_EMAIL: "1" },
    }),
    { port: again, persistTo },
  );
  await live(`http://127.0.0.1:${String(again)}`, cookie);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  if (server) await stop(server);
  await rm(persistTo, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(
    `\nthe hosted Worker did not serve its Workspaces:\n${failures.map((f) => `  ${f}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("\nthe hosted Worker serves its Workspaces");

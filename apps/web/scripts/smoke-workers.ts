/**
 * Drives the built Worker over HTTP on workerd (docs/plans/m3.md slices 4 and 5).
 *
 * `wrangler dev --local` is miniflare with a real local D1 and a real local
 * Queue, so this needs no Cloudflare account. It is a script rather than a
 * vitest file because apps/web's test environment is jsdom and this is neither
 * jsdom nor node's own: what it tests is the deployed shape, bindings and
 * asset routing included, which a unit test of anything the Worker calls
 * cannot see.
 *
 * Seven phases, seven servers, over one build and one D1. The first serves
 * deevy on a configured origin the request did not arrive on, which is how it
 * proves the bindings reached the app. The second signs a Human in, and a
 * sign-in needs BETTER_AUTH_URL to be the origin the browser is on — so it
 * picks its port first, and takes the stubbed GitHub with it. The third fires
 * the Cron Trigger by hand and watches the background work happen on D1, and
 * it signs in too, because what it reads back it reads over the API. The
 * fourth watches the Event log the way the SPA does, over a stream short
 * enough to end while the smoke is looking at it. The fifth is the milestone
 * itself: a Claude Code loop working an assigned Issue over /mcp with an
 * Agent's API key, and a Human deciding its Gate over /rpc
 * (docs/plans/m3.md slice 10). The sixth adds the queue binding an account
 * with Queues has, and the seventh takes it away again — the same webhook,
 * delivered by the Cron path alone, which is what makes the binding optional
 * (docs/plans/m3.md slice 9).
 *
 * Two checks with no server at all close it: that the shape a free account
 * deploys passes a dry run, and that the file the dry run validates is the one
 * the build emitted rather than the one in the repository
 * (docs/plans/m3.md slice 10).
 */
import type { AppRouter } from "@deevy/core";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { STREAM_POLL_MS } from "../src/env.ts";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const wrangler = join(here, "../node_modules/.bin/wrangler");
const vp = join(here, "../node_modules/.bin/vp");
/** What the Cloudflare plugin writes: the committed configuration plus the built assets. */
const config = join(here, "../dist/deevy/wrangler.json");
const database = "deevy";
/**
 * The configured origin of the first phase, deliberately not the one the
 * request arrives on: the RFC 9728 challenge names it, so a challenge carrying
 * it proves readWorkerEnv reached the app.
 *
 * Every binding rides on `--var` rather than `.dev.vars`, which wrangler
 * resolves beside the configuration it was handed: naming the built one skips
 * the developer's own file, and that is what these runs want.
 */
const baseURL = "https://deevy.example.test";
/** The email DEEVY_ADMIN_EMAIL names, whose first sign-in bootstraps the Workspace. */
const adminEmail = "ada@example.com";

const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: childEnv, ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}`)),
    );
  });
}

/**
 * The SPA and the Worker bundle wrangler serves. Always rebuilt: `wrangler dev`
 * reads the configuration the Cloudflare plugin writes, not the committed one,
 * so a left-over `dist` would answer for a routing table nobody has any more —
 * the exact silence this script exists to break (apps/web/vite.config.ts).
 */
async function build(): Promise<void> {
  await run(vp, ["build"], {
    cwd: join(here, ".."),
    env: { ...childEnv, DEEVY_TARGET: "workers" },
  });
}

export interface StartOptions {
  /** The wrangler configuration to serve, which decides the Worker bundle. */
  config: string;
  /** 0 lets wrangler choose; a sign-in needs a port its BETTER_AUTH_URL can name. */
  port: number;
  /** What `readWorkerEnv` will see, as `wrangler dev --var` pairs. */
  vars: Record<string, string>;
}

/** wrangler dev, up and answering, and the origin it chose. */
function start(
  persistTo: string,
  options: StartOptions,
): Promise<{ origin: string; child: ChildProcess }> {
  const child = spawn(
    wrangler,
    [
      "dev",
      "--local",
      "--config",
      options.config,
      "--persist-to",
      persistTo,
      "--ip",
      "127.0.0.1",
      ...Object.entries(options.vars).flatMap(([name, value]) => ["--var", `${name}:${value}`]),
      "--port",
      String(options.port),
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: childEnv },
  );
  return new Promise((resolve, reject) => {
    // Nothing outside this promise holds the process yet, so a start that never
    // finishes has to take its own server down with it.
    const fail = (error: Error) => {
      child.kill("SIGTERM");
      reject(error);
    };
    let output = "";
    const watch = (chunk: Buffer) => {
      output += chunk.toString();
      const ready = /Ready on (https?:\/\/[^\s]+?)\/?\s/.exec(output);
      if (ready?.[1]) resolve({ origin: ready[1], child });
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("error", reject);
    child.on("exit", (code) => {
      reject(new Error(`wrangler dev exited ${String(code)} before it was ready:\n${output}`));
    });
    setTimeout(() => {
      fail(new Error(`wrangler dev was not ready in 60s:\n${output}`));
    }, 60_000).unref();
  });
}

/** Two JSON documents compared by value, whatever whitespace they arrived in. */
function canonical(json: string): string {
  return JSON.stringify(JSON.parse(json));
}

/** A port nothing else holds, so BETTER_AUTH_URL can name the origin in advance. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** The entry those two stubs are prepended to, which the queue wrapper imports. */
const stubMain = "index.stub.js";

/** The Queue this run names. Only the phase that has a binding ever mentions it. */
const queueName = "deevy-jobs-smoke";

/**
 * The same built Worker with the outside world replaced, and the configuration
 * that serves it. Better Auth hardcodes a provider's endpoints and a
 * subscription URL has to be https, so the seam for both is the isolate's
 * global `fetch`: scripts/stub-oauth.js and scripts/stub-receiver.js go in front of the
 * bundle and everything else — the D1 binding, the routing table, createApp
 * itself — is what a deployment gets (docs/plans/m3.md slices 5 and 9).
 */
async function stubbedOutside(): Promise<string> {
  const stubConfig = join(here, "../dist/deevy/wrangler.stub.json");
  const [oauth, receiver, bundle, written] = await Promise.all([
    readFile(join(here, "stub-oauth.js"), "utf8"),
    readFile(join(here, "stub-receiver.js"), "utf8"),
    readFile(join(here, "../dist/deevy/index.js"), "utf8"),
    readFile(config, "utf8"),
  ]);
  await writeFile(join(here, "../dist/deevy", stubMain), `${oauth}\n${receiver}\n${bundle}`);
  await writeFile(stubConfig, JSON.stringify({ ...JSON.parse(written), main: stubMain }));
  return stubConfig;
}

/**
 * The stubbed Worker again, plus everything an account that has Queues brings:
 * the producer binding `createApp` nudges deliveries on, a consumer of it, and
 * the wrapper that lets this script put a message on the same queue by hand.
 *
 * `retry_delay: 0` is what makes the eighth attempt something a smoke run can
 * wait for. It changes when the consumer is asked again and nothing else: the
 * backoff that matters is the delivery row's own, and `deliverWebhook` claims
 * a row by id rather than by whether it is due, exactly as a Redeliver does.
 */
async function withQueues(base: string): Promise<string> {
  const queueConfig = join(here, "../dist/deevy/wrangler.queues.json");
  const [hand, written] = await Promise.all([
    readFile(join(here, "stub-queue-hand.js"), "utf8"),
    readFile(base, "utf8"),
  ]);
  const handMain = "index.queue-hand.js";
  await writeFile(join(here, "../dist/deevy", handMain), hand);
  const parsed = JSON.parse(written) as {
    assets?: { run_worker_first?: string[] };
    [key: string]: unknown;
  };
  await writeFile(
    queueConfig,
    JSON.stringify({
      ...parsed,
      main: handMain,
      // The wrapper's own path, which createApp does not mount: without it the
      // asset handler answers with the SPA and the message is never sent.
      assets: {
        ...parsed.assets,
        run_worker_first: [...(parsed.assets?.run_worker_first ?? []), "/__smoke/*"],
      },
      queues: {
        producers: [{ binding: "JOBS", queue: queueName }],
        consumers: [
          {
            queue: queueName,
            max_batch_size: 1,
            max_batch_timeout: 1,
            max_retries: 10,
            retry_delay: 0,
          },
        ],
      },
    }),
  );
  return queueConfig;
}

/** Every cookie a response set, as one request header. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

interface SignedIn {
  /** Where Better Auth sent the browser next: `/api/auth/error?...` when it refused. */
  location: string;
  /** The session cookie the Worker minted. */
  cookie: string;
}

/**
 * One Human signing in with GitHub, as the browser would do it: ask for the
 * authorization URL, then come back to the callback with the state it carried
 * and the code GitHub would have handed out. The code is the email address,
 * which is how the stub knows who arrived.
 */
async function signIn(origin: string, email: string): Promise<SignedIn> {
  const started = await fetch(`${origin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/" }),
  });
  const text = await started.text();
  let url: string | undefined;
  try {
    url = (JSON.parse(text) as { url?: string }).url;
  } catch {
    url = undefined;
  }
  if (!url) {
    throw new Error(
      `no authorization URL for ${email}: ${String(started.status)} ${text.slice(0, 200)}`,
    );
  }
  const state = new URL(url).searchParams.get("state") ?? "";

  const callback = await fetch(
    `${origin}/api/auth/callback/github?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(started) }, redirect: "manual" },
  );
  return { location: callback.headers.get("location") ?? "", cookie: cookiesOf(callback) };
}

interface RpcResult {
  status: number;
  /** The `json` field of an oRPC response, or null when there was none to read. */
  output: unknown;
  body: string;
  /** What the response called itself, or "" when it said nothing. */
  contentType: string;
  /**
   * Whether the body was JSON at all. A failed parse is a fact a caller can
   * assert on rather than something this helper swallows: an error page that
   * happens to contain the right word is exactly what "in JSON" rules out.
   */
  parsed: boolean;
}

/** One oRPC call over the Worker's /rpc surface, as the SPA makes it. */
async function rpc(
  origin: string,
  procedure: string,
  input: unknown,
  cookie?: string,
): Promise<RpcResult> {
  const response = await fetch(`${origin}/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const body = await response.text();
  let output: unknown = null;
  let parsed = false;
  try {
    output = (JSON.parse(body) as { json?: unknown }).json;
    parsed = true;
  } catch {
    output = null;
  }
  return {
    status: response.status,
    output,
    body,
    contentType: response.headers.get("content-type") ?? "",
    parsed,
  };
}

/** One statement or many, against the local D1 this run persists to. */
function execute(persistTo: string, sql: string): Promise<void> {
  return run(wrangler, [
    "d1",
    "execute",
    database,
    "--local",
    "--config",
    config,
    "--persist-to",
    persistTo,
    "--command",
    sql,
  ]);
}

/** The Issue every seeded Run is on, so the phase can ask for them by key. */

/**
 * An Agent with `count` Runs that have been silent for 31 minutes, straight
 * into the tables of the D1 the sign-in phase left behind.
 *
 * Seeded rather than driven through the API for two reasons: an Agent has one
 * open Run per Issue, so sixty of them is not a shape the API will make, and
 * the server is down while this runs, which keeps one SQLite file to one
 * writer. The Agent gets no schedule, so the only sweep with anything to do is
 * the stale one.
 */
function seedSilentRuns(persistTo: string, count: number): Promise<void> {
  const silentFor = 31 * 60 * 1000;
  // An Issue each, because one Agent cannot hold two open Runs on one Issue and
  // the database says so (`packages/db/src/schema/run.ts`). The sweep does not
  // care which Issue a silent Run is on; what it needs is `count` of them.
  const issues = Array.from(
    { length: count },
    (_, at) =>
      `('swept-issue-${String(at)}', 'swept-project', ${String(at + 1)}, 'Ship the thing', 'swept-state')`,
  ).join(", ");
  const runs = Array.from(
    { length: count },
    (_, at) =>
      `('swept-run-${String(at)}', 'swept-issue-${String(at)}', 'swept-member', 'manual', 'active', ` +
      `cast(unixepoch('subsecond') * 1000 as integer) - ${String(silentFor)})`,
  ).join(", ");
  return execute(
    persistTo,
    [
      `INSERT INTO user (id, name, email, kind) VALUES ('swept-user', 'Sweeper', 'sweeper@example.test', 'agent')`,
      `INSERT INTO member (id, workspace_id, user_id, role, kind) SELECT 'swept-member', id, 'swept-user', 'member', 'agent' FROM workspace LIMIT 1`,
      `INSERT INTO agent (member_id) VALUES ('swept-member')`,
      `INSERT INTO project (id, workspace_id, key, name) SELECT 'swept-project', id, 'SWP', 'Sweeping' FROM workspace LIMIT 1`,
      `INSERT INTO workflow_state (id, project_id, name, position, category) VALUES ('swept-state', 'swept-project', 'Doing', 1, 'active')`,
      `INSERT INTO issue (id, project_id, number, title, state_id) VALUES ${issues}`,
      `INSERT INTO run (id, issue_id, agent_member_id, trigger, status, last_activity_at) VALUES ${runs}`,
    ].join("; "),
  );
}

/**
 * Fires one Cron Trigger and waits for it, which is what the response means:
 * workerd holds the invocation open for `ctx.waitUntil`, so a 200 here is the
 * pass having finished and an exception in it comes back as a 500.
 *
 * `wrangler dev --test-scheduled` advertises `/__scheduled` for this, and on a
 * Worker that also serves assets it does not work: the path is not in
 * `assets.run_worker_first` — and must not be, since `createApp` does not
 * mount it — so the asset handler answers with the SPA's index.html and a 200
 * that ran nothing. `/cdn-cgi/handler/scheduled` is the route `/__scheduled`
 * forwards to, and `/cdn-cgi/*` is the platform's, so nothing intercepts it.
 */
async function trigger(origin: string): Promise<number> {
  const fired = await fetch(
    `${origin}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}`,
  );
  await fired.text();
  return fired.status;
}

/**
 * The status of every Run the seeded Agent holds, as the API reports them. By
 * Agent rather than by Issue: one Agent cannot hold two open Runs on one Issue
 * (`packages/db/src/schema/run.ts`), so the sixty silent Runs the sweep is
 * given sit on sixty Issues.
 */
async function sweptStatuses(origin: string, cookie: string): Promise<string[]> {
  const listed = await rpc(
    origin,
    "runs/list",
    { agentMemberId: "swept-member", limit: 200 },
    cookie,
  );
  const runs = (listed.output as { runs?: Array<{ status?: string }> } | null)?.runs;
  if (!runs) throw new Error(`the Runs could not be read: ${listed.body.slice(0, 300)}`);
  return runs.map((run) => run.status ?? "");
}

/** How many Runs the Event log says went stale, and which ones. */
async function wentStale(origin: string, cookie: string): Promise<string[]> {
  const listed = await rpc(origin, "events/list", { limit: 500 }, cookie);
  const events = (listed.output as { events?: Array<{ kind?: string; subjectId?: string }> } | null)
    ?.events;
  if (!events) throw new Error(`the Events could not be read: ${listed.body.slice(0, 300)}`);
  return events.filter((event) => event.kind === "run.went_stale").map((e) => e.subjectId ?? "");
}

function countOf(statuses: string[], status: string): number {
  return statuses.filter((each) => each === status).length;
}

/** Slice 6: the background work, on a Cron Trigger, inside one trigger's budget. */
async function backgroundWorkOnACronTrigger(origin: string): Promise<void> {
  const admin = await signIn(origin, adminEmail);
  if (admin.cookie.length === 0) throw new Error(`the admin could not sign in: ${admin.location}`);

  // A trigger has a CPU budget and a per-invocation query cap, and Cloudflare
  // brings it back a minute later, so the Worker asks for one pass of twenty
  // and no more. Sixty due Runs and one trigger states that as a fact.
  const status = await trigger(origin);
  const afterOne = await sweptStatuses(origin, admin.cookie);
  const eventsAfterOne = await wentStale(origin, admin.cookie);
  check(
    "one trigger moves one bounded pass of the backlog, and no more",
    status === 200 && countOf(afterOne, "stale") === 20,
    `status ${String(status)}, ${String(countOf(afterOne, "stale"))} of ${String(afterOne.length)} stale`,
  );
  check(
    "every Run it moved says so in a run.went_stale Event",
    eventsAfterOne.length === 20 && new Set(eventsAfterOne).size === 20,
    `${String(eventsAfterOne.length)} Events, ${String(new Set(eventsAfterOne).size)} distinct`,
  );

  await trigger(origin);
  await trigger(origin);
  const afterThree = await sweptStatuses(origin, admin.cookie);
  check(
    "three triggers move all sixty",
    countOf(afterThree, "stale") === 60,
    `${String(countOf(afterThree, "stale"))} of ${String(afterThree.length)} stale`,
  );

  // Nothing is due any more, and a Run already `stale` is never swept twice:
  // the sweep only ever looks at `pending` and `active`. So the Event log holds
  // one run.went_stale per seeded Run and the fourth trigger adds none. Counted
  // as an array either side of that trigger, not only as a set of subjects: a
  // second Event for a Run already stale would leave the set at sixty, and the
  // set is what makes the rest of this check readable.
  const before = await wentStale(origin, admin.cookie);
  await trigger(origin);
  const after = await wentStale(origin, admin.cookie);
  const stale = new Set(after);
  const seeded = Array.from({ length: 60 }, (_, at) => `swept-run-${String(at)}`);
  check(
    "a further trigger changes nothing, and every Run has exactly its own Event",
    countOf(await sweptStatuses(origin, admin.cookie), "stale") === 60 &&
      after.length === 60 &&
      after.length === before.length &&
      stale.size === 60 &&
      seeded.every((id) => stale.has(id)),
    `${String(after.length)} Events after the trigger and ${String(before.length)} before, ${String(stale.size)} distinct for ${String(seeded.filter((id) => stale.has(id)).length)} of the seeded Runs`,
  );
}

/**
 * How long a stream lives in the fourth phase. The deployed default is a
 * minute; this is short enough that a stream reaching its limit is something a
 * smoke run can wait for, and still several polls long.
 */
const streamSeconds = 8;

/** One message an Event stream delivered, narrowed to what this script reads. */
interface WatchedMessage {
  type: string;
  cursor?: number | null;
  event?: { seq: number; kind: string };
}

/**
 * One browser watching the Event log, over the RPC surface and the client the
 * SPA itself uses: `useLiveEvents` calls exactly this (apps/web/src/lib/live.ts).
 */
interface Watcher {
  /** Every message the stream has delivered, in order. */
  messages: WatchedMessage[];
  /** Set when the stream ended of its own accord rather than being cut off. */
  ended: boolean;
  /** What the stream threw, if it threw. */
  failure: unknown;
  stop(): void;
}

function watch(origin: string, cookie: string, after?: number): Watcher {
  const controller = new AbortController();
  const link = new RPCLink({ origin, url: "/rpc", headers: { cookie } });
  const client: RouterClient<AppRouter> = createORPCClient(link);
  const watcher: Watcher = {
    messages: [],
    ended: false,
    failure: undefined,
    stop: () => {
      controller.abort();
    },
  };
  void (async () => {
    const stream = await client.events.subscribe(after === undefined ? {} : { after }, {
      signal: controller.signal,
    });
    for await (const message of stream) watcher.messages.push(message);
    watcher.ended = true;
  })().catch((error: unknown) => {
    watcher.failure = error;
  });
  return watcher;
}

/**
 * A thrown value as something a failing smoke can be read from. `String` on an
 * `unknown` is how a stream failure becomes '[object Object]' in the one line
 * that was supposed to explain it.
 */
function describeFailure(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return JSON.stringify(value) ?? "nothing";
}

/** Waits for something to become true, and says whether it did. */
async function until(what: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!what() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return what();
}

/** The kinds of Event a watcher has been handed, in order. */
function kindsSeenBy(watcher: Watcher): string[] {
  return watcher.messages.flatMap((message) => (message.event ? [message.event.kind] : []));
}

/** One call that has to work for the phase to mean anything. */
async function must(
  origin: string,
  procedure: string,
  input: unknown,
  cookie: string,
): Promise<Record<string, unknown>> {
  const response = await rpc(origin, procedure, input, cookie);
  if (response.status !== 200) {
    throw new Error(`${procedure} was ${String(response.status)}: ${response.body.slice(0, 300)}`);
  }
  return (response.output ?? {}) as Record<string, unknown>;
}

/** Slice 7: the board updates itself on Workers, and a stream that ends says where it got to. */
async function liveUpdatesInsideAWorkersBudget(origin: string): Promise<void> {
  const admin = await signIn(origin, adminEmail);
  if (admin.cookie.length === 0) throw new Error(`the admin could not sign in: ${admin.location}`);

  // An Issue somewhere it can be moved from. The default Workflow opens with
  // three Gates, and an Issue only leaves a Gate by being approved through it,
  // so three approvals put it in Build, which is nobody's Gate.
  const project = await must(origin, "projects/create", { name: "Live", key: "LIV" }, admin.cookie);
  const states = (project.states ?? []) as Array<{ id: string; name: string }>;
  const issue = await must(
    origin,
    "issues/create",
    { projectKey: "LIV", title: "Watch me move" },
    admin.cookie,
  );
  const key = String(issue.key);
  for (const _ of ["Intent", "Spec", "Plan"]) {
    await must(origin, "gates/approve", { key }, admin.cookie);
  }
  const review = states.find((state) => state.name === "Review");
  if (!review)
    throw new Error(`the default Workflow has no Review State: ${JSON.stringify(states)}`);

  // Two browsers, both watching, neither told anything by the other.
  const first = watch(origin, admin.cookie);
  const second = watch(origin, admin.cookie);
  const opened = await until(
    () => first.messages.length > 0 && second.messages.length > 0,
    streamSeconds * 1000,
  );
  if (!opened) {
    throw new Error(
      `the streams never opened: ${describeFailure(first.failure ?? second.failure)}`,
    );
  }

  await must(origin, "issues/move", { key, stateId: review.id }, admin.cookie);
  const bothSaw = await until(
    () => kindsSeenBy(first).includes("issue.moved") && kindsSeenBy(second).includes("issue.moved"),
    // One poll, and a second one's worth of slack for a loaded machine.
    2 * STREAM_POLL_MS,
  );
  check(
    "two browsers watching the same Workspace both see an Issue move",
    bothSaw,
    `one saw ${kindsSeenBy(first).join(",") || "nothing"} and the other ${kindsSeenBy(second).join(",") || "nothing"}`,
  );

  // The stream the platform would otherwise cut off ends itself instead, and
  // the last thing it says is where the next one should start.
  const endedOnPurpose = await until(() => first.ended, streamSeconds * 1000 + 2 * STREAM_POLL_MS);
  const last = first.messages.at(-1);
  check(
    "a stream past its limit ends itself, signing off with its cursor",
    endedOnPurpose && last?.type === "heartbeat" && typeof last.cursor === "number",
    `ended ${String(first.ended)}, last message ${JSON.stringify(last)}${
      first.failure ? `, failed with ${describeFailure(first.failure)}` : ""
    }`,
  );
  second.stop();

  // What the SPA does next, and the only thing that makes the end invisible:
  // resume from that cursor, and the Event that happened in between is there.
  const cursor = typeof last?.cursor === "number" ? last.cursor : 0;
  const missed = await must(
    origin,
    "issues/create",
    { projectKey: "LIV", title: "Appended while nobody was watching" },
    admin.cookie,
  );
  const resumed = watch(origin, admin.cookie, cursor);
  const caughtUp = await until(
    () => kindsSeenBy(resumed).includes("issue.created"),
    2 * STREAM_POLL_MS,
  );
  check(
    "the stream that follows it resumes from that cursor and misses nothing",
    // Exactly what the first stream did not deliver: the Event appended after
    // it ended, and not the move it had already handed over.
    caughtUp && !kindsSeenBy(resumed).includes("issue.moved"),
    `${String(missed.key)} was not delivered; from ${String(cursor)} the stream saw ${
      kindsSeenBy(resumed).join(",") || "nothing"
    }`,
  );
  resumed.stop();
}

/** The protocol revision the loop speaks, and the one URL elicitation needs. */
const mcpProtocolVersion = "2026-07-28";

/**
 * What a client says about itself on every call. URL elicitation is negotiated
 * per request, so a client that does not declare it is refused rather than
 * handed a link it cannot open.
 */
const mcpEnvelope = {
  "io.modelcontextprotocol/protocolVersion": mcpProtocolVersion,
  "io.modelcontextprotocol/clientCapabilities": { elicitation: { url: {} } },
  "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "0" },
};

/** One tool call's answer, narrowed to what this script reads. */
interface ToolAnswer {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * One tool call over the deployed `/mcp` surface, carrying nothing but an
 * Agent's API key — which is all a Claude Code loop running outside deevy has.
 * The same request `packages/core/tests/milestone.test.ts` makes in process,
 * made over HTTP against workerd instead.
 */
async function tool(
  origin: string,
  key: string,
  name: string,
  args: Record<string, unknown>,
  requestState?: string,
): Promise<ToolAnswer> {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": mcpProtocolVersion,
      "mcp-method": "tools/call",
      "mcp-name": name,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        ...(requestState
          ? { requestState, inputResponses: { approval: { action: "accept" } } }
          : {}),
        _meta: mcpEnvelope,
      },
    }),
  });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`${name} was ${String(response.status)}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body) as ToolAnswer;
}

/** What a tool call returned, or the reason it is worth stopping over. */
function structured(name: string, answer: ToolAnswer): Record<string, unknown> {
  if (answer.error) throw new Error(`${name} failed: ${JSON.stringify(answer.error)}`);
  if (answer.result?.isError) {
    throw new Error(`${name} refused: ${JSON.stringify(answer.result.content)}`);
  }
  return (answer.result?.structuredContent ?? {}) as Record<string, unknown>;
}

/**
 * Slice 10: the milestone's own scenario, on workerd.
 *
 * `packages/core/tests/milestone.test.ts` walks this loop in process against
 * `node:sqlite`, which proves the core and says nothing about the runtime M3
 * is about. This is the same walk over HTTP against the built Worker on a
 * local D1: everything the loop does goes over `/mcp` with an Agent's API key
 * and nothing else, everything the Human does goes over `/rpc` with a session
 * cookie the Worker minted, and the two halves meet only where they would in
 * production (docs/plans/m3.md slice 10, docs/m3-acceptance.md).
 */
async function theAgentLoopOnWorkerd(origin: string): Promise<void> {
  const admin = await signIn(origin, adminEmail);
  if (admin.cookie.length === 0) throw new Error(`the admin could not sign in: ${admin.location}`);
  const cookie = admin.cookie;

  // A browser left open on the board before any of this happens, and never
  // reloaded: what the Human is looking at while the loop works.
  const board = watch(origin, cookie);
  await until(() => board.messages.length > 0, 2 * STREAM_POLL_MS);

  // What an admin does on a fresh instance, all of it over the surface the SPA
  // calls: a Project, an Agent, the grant that makes the Project exist to it,
  // and a key that is shown exactly once.
  const project = await must(origin, "projects/create", { name: "Planning", key: "PLN" }, cookie);
  const planner = await must(origin, "agents/create", { name: "Planner" }, cookie);
  const plannerId = String(planner.id);
  await must(origin, "agents/grants/add", { memberId: plannerId, projectId: project.id }, cookie);
  const issued = await must(
    origin,
    "agents/keys/issue",
    { memberId: plannerId, name: "ci" },
    cookie,
  );
  const key = String(issued.key);

  // Assigning to the Agent is the trigger: a Run exists before the loop wakes.
  // The two approvals are the Human's, and they put the Issue in the Plan Gate
  // — the one the loop is about to reach.
  const issue = await must(
    origin,
    "issues/create",
    { projectKey: "PLN", title: "Ship M3" },
    cookie,
  );
  const issueKey = String(issue.key);
  await must(origin, "issues/update", { key: issueKey, assigneeMemberId: plannerId }, cookie);
  await must(origin, "gates/approve", { key: issueKey }, cookie);
  await must(origin, "gates/approve", { key: issueKey }, cookie);

  const triggered = (await must(origin, "runs/list", { issueKey }, cookie)).runs as Array<{
    id: string;
    trigger: string;
    status: string;
  }>;

  // From here everything is the loop, over MCP, with nothing but its key.
  const mine = structured("runs_list", await tool(origin, key, "runs_list", { status: "pending" }))
    .runs as Array<{ id: string; issueKey: string }>;
  check(
    "an assignment opens a Run, and an Agent's API key alone finds it over /mcp",
    triggered.length === 1 &&
      triggered[0]?.trigger === "assignment" &&
      triggered[0]?.status === "pending" &&
      mine.length === 1 &&
      mine[0]?.id === triggered[0]?.id &&
      mine[0]?.issueKey === issueKey,
    `the Human sees ${JSON.stringify(triggered)}, the Agent ${JSON.stringify(mine)}`,
  );

  const read = structured("issues_get", await tool(origin, key, "issues_get", { key: issueKey }));
  check(
    "the Issue the loop picks up is the assigned one, waiting at the Plan Gate",
    read.key === issueKey && (read.state as { name?: string } | undefined)?.name === "Plan",
    `it read ${JSON.stringify({ key: read.key, state: read.state })}`,
  );

  const runId = String(triggered[0]?.id ?? "");

  await tool(origin, key, "runs_post_activity", {
    runId,
    kind: "thought",
    body: "Reading the intent",
  });
  const intent = structured(
    "documents_get",
    await tool(origin, key, "documents_get", { issueKey, name: "intent" }),
  );
  await tool(origin, key, "documents_write", {
    issueKey,
    name: "plan",
    body: "## Files that change\n- packages/core\n",
  });

  // What the Human sees of that work afterwards, over /rpc: the narration on
  // the Run's feed and the Document on the Issue.
  const feed = (await must(origin, "runs/get", { runId }, cookie)).activities as Array<{
    kind: string;
    body: string;
  }>;
  const plan = await must(origin, "documents/get", { issueKey, name: "plan" }, cookie);
  check(
    "it reads the intent, narrates the work, and writes a plan the Human can read",
    String(intent.body).includes("## Problem") &&
      feed.some((one) => one.kind === "thought" && one.body === "Reading the intent") &&
      String(plan.body).includes("- packages/core"),
    `the intent is ${JSON.stringify(String(intent.body).slice(0, 40))}, the feed ${JSON.stringify(
      feed.map((one) => [one.kind, one.body]),
    )} and the plan ${JSON.stringify(plan.body)}`,
  );

  // It reaches the Plan Gate and asks. The Run stops, and the link it hands
  // back is for a Human to open — the Issue's own page, with that Gate in
  // focus. Which Gate that is comes from the Human's view of the Workflow, so
  // the two halves of the link are named by different surfaces.
  const asked = (await tool(origin, key, "runs_request_approval", { runId })).result as {
    resultType?: string;
    requestState?: string;
    inputRequests?: { approval?: { params?: { url?: string; mode?: string } } };
  };
  const planGate = ((project.states ?? []) as Array<{ id: string; name: string }>).find(
    (state) => state.name === "Plan",
  );
  const waiting = await must(origin, "runs/get", { runId }, cookie);
  check(
    "at the Plan Gate it raises a URL elicitation, and the Run stops to wait",
    asked.resultType === "input_required" &&
      asked.inputRequests?.approval?.params?.mode === "url" &&
      asked.inputRequests.approval.params.url ===
        `${origin}/issues/${issueKey}?gate=${String(planGate?.id)}` &&
      waiting.status === "awaiting_input",
    `it answered ${JSON.stringify(asked)}, the Plan Gate is ${String(planGate?.id)}, and the Run is ${String(waiting.status)}`,
  );

  // The Human opens that link and approves. The loop retries the same call,
  // carrying back the state it was given, and is told the ruling.
  await must(origin, "gates/approve", { key: issueKey, note: "Looks right" }, cookie);
  const answered = structured(
    "runs_request_approval",
    await tool(origin, key, "runs_request_approval", { runId }, asked.requestState),
  );
  const carriedOn = await must(origin, "runs/get", { runId }, cookie);
  check(
    "the Human approves, and the call the loop retries comes back approved",
    answered.status === "approved" &&
      answered.note === "Looks right" &&
      carriedOn.status === "active",
    `the loop was told ${JSON.stringify(answered)} and the Run is ${String(carriedOn.status)}`,
  );

  // It carries on, attaches the pull request it opened, and finishes.
  await tool(origin, key, "links_add", {
    issueKey,
    url: "https://github.com/WeAreNendo/deevy/pull/12",
    runId,
  });
  const finished = structured(
    "runs_finish",
    await tool(origin, key, "runs_finish", { runId, status: "completed", summary: "Planned it" }),
  );

  // What the Human is left with: a finished Run, the evidence attached to the
  // Issue, and the Issue itself past the Gate it was waiting at.
  const done = await must(origin, "runs/get", { runId }, cookie);
  const links = (await must(origin, "links/list", { issueKey }, cookie)).links as Array<
    Record<string, unknown>
  >;
  const moved = await must(origin, "issues/get", { key: issueKey }, cookie);
  check(
    "it finishes the Run with a summary and a pull request Link, and the Issue moves on",
    finished.status === "completed" &&
      finished.summary === "Planned it" &&
      done.status === "completed" &&
      done.summary === "Planned it" &&
      links.length === 1 &&
      links[0]?.kind === "pull_request" &&
      links[0]?.ref === "12" &&
      (moved.state as { name?: string } | undefined)?.name === "Build",
    `the loop was told ${JSON.stringify(finished)}, the Human sees ${JSON.stringify({ status: done.status, summary: done.summary })}, the Links are ${JSON.stringify(links)} and the Issue is in ${JSON.stringify(moved.state)}`,
  );

  const inbox = (await must(origin, "inbox/list", {}, cookie)).notifications as Array<{
    kind: string;
    event?: { subjectId?: string };
  }>;
  check(
    "the Human's inbox holds the run_finished Notification for that Run",
    inbox.some((row) => row.kind === "run_finished" && row.event?.subjectId === runId),
    `the inbox holds ${JSON.stringify(inbox.map((row) => [row.kind, row.event?.subjectId]))}`,
  );

  // And the Event log tells the whole story. The kinds are the ones the same
  // walk records on Node (packages/core/tests/milestone.test.ts), so a runtime
  // that quietly dropped one would say so here.
  const me = await must(origin, "me/get", undefined, cookie);
  const adminMemberId = String((me.member as { id?: string } | null)?.id);
  const log = (
    await must(origin, "events/list", { subjectType: "run", subjectId: runId, limit: 200 }, cookie)
  ).events as Array<{ kind: string; actorMemberId: string | null }>;
  // Accountability reads straight off the log: the Agent narrated its own
  // work, and the two Events it could not cause itself carry the Human who
  // did — the admin assigned the Issue, which started the Run, and the admin
  // decided the Gate.
  const humansTurn = ["run.started", "run.answered"];
  const actors = log.map((row) => [
    row.kind,
    row.actorMemberId === adminMemberId
      ? "the Human"
      : row.actorMemberId === plannerId
        ? "the Agent"
        : String(row.actorMemberId),
  ]);
  check(
    "the Event log tells the whole story, with the Agent as actor and the Human one hop away",
    log.map((row) => row.kind).join(",") ===
      [
        "run.started",
        "run.activity",
        "run.activity",
        "run.awaiting_input",
        "run.answered",
        "run.activity",
        "run.completed",
      ].join(",") &&
      log.every(
        (row) => row.actorMemberId === (humansTurn.includes(row.kind) ? adminMemberId : plannerId),
      ),
    `the log reads ${JSON.stringify(actors)}`,
  );

  // And the board updated itself while all of that happened. The three Events
  // are the ones a Human watching would care about: the Run stopping to ask,
  // the Gate they then decided, and the Run finishing. An approval carries the
  // Issue out of the Gate itself, so `gate.approved` is the move — there is no
  // second `issue.moved` behind it.
  const followed = await until(
    () =>
      ["run.awaiting_input", "gate.approved", "run.completed"].every((kind) =>
        kindsSeenBy(board).includes(kind),
      ),
    3 * STREAM_POLL_MS,
  );
  board.stop();
  check(
    "a board opened before the loop began follows it without anyone reloading",
    followed,
    `it was handed ${kindsSeenBy(board).join(",") || "nothing"}${
      board.failure ? `, and failed with ${describeFailure(board.failure)}` : ""
    }`,
  );
}

/** One POST a subscribed URL was given, narrowed to what this script reads. */
interface Received {
  path: string;
  /** The delivery row it names, which a retry of the same row repeats. */
  delivery: string;
}

interface Receiver {
  /** The origin a subscription points at; stub-receiver.js maps it onto this server. */
  origin: string;
  /** Every POST it has been given, in order. */
  posts: Received[];
  /** How many landed on one path. */
  count(path: string): number;
  close(): Promise<void>;
}

/**
 * The far side of a webhook: a plain HTTP server on 127.0.0.1 that counts what
 * it is given and answers 500 on any path with `fail` in it, which is how a
 * phase watches a delivery run out of attempts. `https://receiver.smoke.test`
 * is the name deevy is subscribed to, and the stub in front of the bundle is
 * the only thing between the two (docs/plans/m3.md slice 9).
 */
async function receiver(): Promise<Receiver> {
  const posts: Received[] = [];
  const server = createHttpServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    posts.push({ path, delivery: String(request.headers["deevy-delivery"] ?? "") });
    request.resume();
    request.on("end", () => {
      response.writeHead(path.includes("fail") ? 500 : 200).end();
    });
  });
  const port = await freePort();
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    origin: `https://receiver.smoke.test:${String(port)}`,
    posts,
    count: (path) => posts.filter((one) => one.path === path).length,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** The secret every subscription in this run signs with. It never comes back out. */
const subscriptionSecret = "whsec-smoke-secret-not-a-real-one";

/** A Project and a subscription pointed at one path of the receiver. */
async function subscribe(
  origin: string,
  cookie: string,
  options: { project: string; key: string; url: string },
): Promise<string> {
  await must(origin, "projects/create", { name: options.project, key: options.key }, cookie);
  const created = await must(
    origin,
    "webhooks/create",
    { url: options.url, secret: subscriptionSecret, kinds: ["issue.created"] },
    cookie,
  );
  return String(created.id);
}

/** The delivery rows one subscription has, newest first, as the settings page reads them. */
async function deliveriesOf(
  origin: string,
  cookie: string,
  subscriptionId: string,
): Promise<Array<{ id: string; attempts: number; deliveredAt: string | null }>> {
  const read = await must(origin, "webhooks/deliveries", { subscriptionId }, cookie);
  return (read.deliveries ?? []) as Array<{
    id: string;
    attempts: number;
    deliveredAt: string | null;
  }>;
}

/** Every Event of one kind in the Workspace, with what it carried. */
async function eventsOfKind(
  origin: string,
  cookie: string,
  kind: string,
): Promise<Array<{ subjectId: string; payload: Record<string, unknown> }>> {
  const listed = await must(origin, "events/list", { limit: 500 }, cookie);
  const events = (listed.events ?? []) as Array<{
    kind: string;
    subjectId: string;
    payload: Record<string, unknown> | null;
  }>;
  return events
    .filter((event) => event.kind === kind)
    .map((event) => ({ subjectId: event.subjectId, payload: event.payload ?? {} }));
}

/** Slice 9: a delivery goes out when it is written, on an account that has Queues. */
async function queuesForAnAccountThatHasThem(origin: string, far: Receiver): Promise<void> {
  const admin = await signIn(origin, adminEmail);
  if (admin.cookie.length === 0) throw new Error(`the admin could not sign in: ${admin.location}`);

  const landing = await subscribe(origin, admin.cookie, {
    project: "Queued",
    key: "QUE",
    url: `${far.origin}/lands`,
  });
  await must(origin, "issues/create", { projectKey: "QUE", title: "Tell the URL" }, admin.cookie);

  // No trigger is fired here, and none fires on its own: wrangler dev runs a
  // Cron Trigger only when something asks it to (see `trigger` above). So a
  // POST arriving at all is the queue having carried it.
  const arrived = await until(() => far.count("/lands") > 0, 10_000);
  const owed = await deliveriesOf(origin, admin.cookie, landing);
  check(
    "with a queue binding, a webhook is delivered without waiting for a trigger",
    arrived && far.count("/lands") === 1 && owed.length === 1 && owed[0]?.deliveredAt !== null,
    `${String(far.count("/lands"))} POSTs, delivery ${JSON.stringify(owed[0] ?? null)}`,
  );

  // Queues are at-least-once, so the same job comes round again. The row it
  // names has already landed, `deliverWebhook` will not claim one that has,
  // and the second arrival therefore makes no request at all.
  const again = await fetch(`${origin}/__smoke/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "webhook.delivery", id: owed[0]?.id }),
  });
  await again.text();
  // Long enough for a message that was going to be delivered to have been.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = await deliveriesOf(origin, admin.cookie, landing);
  // Counted by the delivery the POST names, not only by the path: two arrivals
  // of the same row are exactly what the header would have made visible.
  const forThatRow = far.posts.filter((one) => one.delivery === owed[0]?.id).length;
  check(
    "the same message delivered twice POSTs once",
    again.status === 200 &&
      forThatRow === 1 &&
      far.count("/lands") === 1 &&
      after[0]?.attempts === 1,
    `enqueue was ${String(again.status)}, ${String(far.count("/lands"))} POSTs of which ${String(
      forThatRow,
    )} name that delivery, ${String(after[0]?.attempts)} attempts`,
  );

  // A receiver that refuses everything, and the consumer asking again until
  // the row itself says there is nothing left to try. The eighth attempt is
  // where `maxWebhookAttempts` runs out and the log says so — which is what
  // the sweep would have written, from the same function.
  const refusing = await subscribe(origin, admin.cookie, {
    project: "Refused",
    key: "REF",
    url: `${far.origin}/fails`,
  });
  await must(origin, "issues/create", { projectKey: "REF", title: "Nobody answers" }, admin.cookie);
  const ranOut = await until(() => far.count("/fails") >= 8, 30_000);
  // One more beat than the eighth POST needs, so a ninth attempt would have
  // been counted by the time this reads the log.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const given = await eventsOfKind(origin, admin.cookie, "webhook.exhausted");
  check(
    "a consumer failure retries, and the eighth attempt gives up exactly as the sweep would",
    ranOut &&
      far.count("/fails") === 8 &&
      given.length === 1 &&
      given[0]?.subjectId === refusing &&
      given[0]?.payload.attempts === 8 &&
      given[0]?.payload.status === 500,
    `${String(far.count("/fails"))} POSTs, ${String(given.length)} webhook.exhausted: ${JSON.stringify(
      given[0] ?? null,
    )}`,
  );

  // Left switched off, so the phase that follows owes them nothing and its one
  // trigger has exactly one delivery to make.
  for (const subscriptionId of [landing, refusing]) {
    await must(origin, "webhooks/update", { subscriptionId, disabled: true }, admin.cookie);
  }
}

/** Slice 9: the same webhook, on an account that has no Queues at all. */
async function theCronPathAlone(origin: string, far: Receiver): Promise<void> {
  const admin = await signIn(origin, adminEmail);
  if (admin.cookie.length === 0) throw new Error(`the admin could not sign in: ${admin.location}`);

  const subscriptionId = await subscribe(origin, admin.cookie, {
    project: "Swept",
    key: "SWT",
    url: `${far.origin}/cron`,
  });
  await must(origin, "issues/create", { projectKey: "SWT", title: "Tell the URL" }, admin.cookie);

  // There is no binding on this configuration, so `createApp` discards the job
  // and nothing carries the row anywhere. Waiting is the assertion.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const beforeTrigger = far.count("/cron");

  const fired = await trigger(origin);
  const delivered = await until(() => far.count("/cron") > 0, 10_000);
  const owed = await deliveriesOf(origin, admin.cookie, subscriptionId);
  check(
    "with no queue block at all, the same webhook is delivered by the Cron path alone",
    beforeTrigger === 0 &&
      fired === 200 &&
      delivered &&
      far.count("/cron") === 1 &&
      owed.length === 1 &&
      owed[0]?.deliveredAt !== null,
    `${String(beforeTrigger)} POSTs before the trigger and ${String(far.count("/cron"))} after it, ` +
      `trigger ${String(fired)}, delivery ${JSON.stringify(owed[0] ?? null)}`,
  );
}

/**
 * The shape a free account can deploy: the configuration a deploy uploads,
 * which names no queue, through the dry run that is that file's typecheck
 * (docs/plans/m3.md, convention 17).
 *
 * Read off the built file rather than the committed one, because the built
 * file is what goes up — and asked of the producer and consumer lists rather
 * than of the `queues` key, because the Cloudflare plugin normalises what it
 * emits: a configuration naming no queue at all still has a `queues` key with
 * two empty lists in it. It is the lists that decide whether a deploy asks a
 * free account for a paid feature, and `wrangler deploy --dry-run` never
 * contacts the account, so nothing else here would notice one appearing.
 */
async function deploysWithoutAQueueBlock(): Promise<void> {
  const committed = await readFile(join(here, "../wrangler.jsonc"), "utf8");
  const uploaded = JSON.parse(await readFile(config, "utf8")) as BuiltConfig;
  const producers = uploaded.queues?.producers ?? [];
  const consumers = uploaded.queues?.consumers ?? [];
  let ok = true;
  try {
    await run(
      wrangler,
      [
        "deploy",
        "--dry-run",
        "--config",
        config,
        "--outdir",
        join(here, "../dist/wrangler-dry-run-smoke"),
      ],
      { cwd: join(here, "..") },
    );
  } catch {
    ok = false;
  }
  check(
    "wrangler deploy --dry-run succeeds on a configuration with no queue block",
    ok && producers.length === 0 && consumers.length === 0 && !committed.includes('"queues"'),
    `the dry run ${ok ? "passed" : "failed"}, and the configuration it validated names ${String(
      producers.length,
    )} queue producers and ${String(consumers.length)} consumers${
      committed.includes('"queues"') ? ", and the committed wrangler.jsonc names a queue" : ""
    }`,
  );
}

/** Whatever `dist/deevy/wrangler.json` says, as far as this script reads it. */
interface BuiltConfig {
  main?: string;
  assets?: { directory?: string };
  /** Normalised by the Cloudflare plugin: present and empty when nothing is queued. */
  queues?: { producers?: unknown[]; consumers?: unknown[] };
}

/** A file that exists and has something in it, or nothing. */
async function contentsOf(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Slice 10: the artifact a deploy uploads is the artifact the build emitted.
 *
 * `wrangler deploy` from apps/web does not upload the committed
 * `wrangler.jsonc`. The Cloudflare plugin writes `.wrangler/deploy/config.json`
 * beside it pointing at `dist/deevy/wrangler.json`, and that file — the built
 * bundle, the built SPA, the routing table copied across — is what goes up.
 * The committed one could not be deployed on its own at all, because the plugin
 * is what supplies `assets.directory`.
 *
 * So the dry run that is the configuration's typecheck has to name the built
 * file rather than trust a redirect nothing tracks: `.wrangler` is gitignored
 * local state, and a check that passes only because the last build happened to
 * leave the right note behind proves nothing about what ships. This phase takes
 * the note away and asks the check to stand on its own.
 */
async function theDeployArtifactIsPinned(): Promise<void> {
  const built = JSON.parse(await readFile(config, "utf8")) as BuiltConfig;
  const source = await readFile(join(here, "../wrangler.jsonc"), "utf8");
  const bundle = built.main ? await contentsOf(join(here, "../dist/deevy", built.main)) : null;
  const spa = built.assets?.directory
    ? await contentsOf(join(here, "../dist/deevy", built.assets.directory, "index.html"))
    : null;
  check(
    "the configuration a deploy uploads is the built Worker and the built SPA",
    // The source names an entry the build compiles and an assets block with no
    // directory; the artifact names neither.
    source.includes('"main": "src/worker.ts"') &&
      built.main !== "src/worker.ts" &&
      (bundle?.length ?? 0) > 0 &&
      (spa?.includes('<div id="root"') ?? false),
    `main ${String(built.main)} (${String(bundle?.length ?? 0)} bytes), assets ${String(
      built.assets?.directory,
    )} (${spa === null ? "no index.html" : "index.html"})`,
  );

  // Taking the note away is the only way to ask the question. It goes back
  // afterwards, because a developer's own `wrangler dev` follows it too.
  const redirect = join(here, "../.wrangler/deploy/config.json");
  const note = await contentsOf(redirect);
  await rm(redirect, { force: true });
  let ok = true;
  try {
    await run(vp, ["run", "check:workers"], { cwd: join(here, "..") });
  } catch {
    ok = false;
  } finally {
    if (note !== null) await writeFile(redirect, note);
  }
  check(
    "check:workers validates that artifact by name, not by the redirect a build left behind",
    ok,
    "the dry run could not find the configuration it was meant to check",
  );
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else failures.push(detail ? `${name}: ${detail}` : name);
}

/** wrangler dev for the length of one phase, and down again whatever happens. */
async function withServer(
  persistTo: string,
  options: StartOptions,
  phase: (origin: string) => Promise<void>,
): Promise<void> {
  const { origin, child } = await start(persistTo, options);
  try {
    await phase(origin);
  } finally {
    child.kill("SIGTERM");
  }
}

/**
 * Live Documents on workerd: the room is a Durable Object, and this is the only
 * place that runs one (ADR-0021). A browser's socket, a Document's text put in
 * over it, and the version the room writes when the typing stops — read back
 * over the API, so what is proven is the whole path and not a binding's name.
 */
async function aDocumentIsLiveOnWorkerd(origin: string): Promise<void> {
  const admin = await signIn(origin, adminEmail);
  if (admin.cookie.length === 0) throw new Error(`the admin could not sign in: ${admin.location}`);

  const health = (await (await fetch(`${origin}/rpc/health/ping`, { method: "POST" })).json()) as {
    json?: { liveDocuments?: boolean };
  };
  check(
    "a Worker with the ROOMS binding says its Documents are live",
    health.json?.liveDocuments === true,
    `liveDocuments ${String(health.json?.liveDocuments)}`,
  );

  const project = await rpc(
    origin,
    "projects/create",
    { name: "Checkout", key: "CHK" },
    admin.cookie,
  );
  const issue = await rpc(
    origin,
    "issues/create",
    { projectKey: (project.output as { key?: string }).key, title: "Live Documents" },
    admin.cookie,
  );
  const issueKey = (issue.output as { key?: string }).key ?? "";
  const room = `document:${issueKey}:intent`;
  check(
    "the room name the SPA builds is the one the server parses",
    room.startsWith("document:"),
    room,
  );

  // The upgrade itself: the room in the query string, because that is what
  // routes to its Durable Object. No cookie on this socket and none needed —
  // Hocuspocus authenticates a *document* rather than a connection, so what is
  // proven here is that the object exists, routes and speaks.
  const socket = new WebSocket(
    `${origin.replace("http", "ws")}/collab?room=${encodeURIComponent(room)}`,
  );
  const opened = await new Promise<boolean>((settled) => {
    socket.addEventListener("open", () => settled(true));
    socket.addEventListener("error", () => settled(false));
    setTimeout(() => settled(false), 10_000);
  });
  check("the Durable Object answers a websocket upgrade on /collab", opened, "it did not open");
  socket.close();

  // And the room is reachable as a room: the Worker's own LiveRooms port goes
  // through the same object, so a write that finds nobody in it still lands.
  const written = await rpc(
    origin,
    "documents/write",
    { issueKey, name: "intent", body: "## Problem\n\nWritten through the Worker." },
    admin.cookie,
  );
  const read = await rpc(origin, "documents/get", { issueKey, name: "intent" }, admin.cookie);
  const document = read.output as { body?: string; basis?: string | null };
  check(
    "a Document written on workerd reads back with a basis to write from",
    document.body?.includes("Written through the Worker.") === true &&
      typeof document.basis === "string",
    `write ${String(written.status)}, basis ${typeof document.basis}, body ${String(document.body).slice(0, 40)}`,
  );
  check(
    "the room name the SPA builds is the one the server parses",
    room.startsWith("document:"),
    room,
  );
}

/** Slice 4: everything deevy serves that needs no signed-in Human. */
async function theWorkerServesDeevy(origin: string): Promise<void> {
  const health = await fetch(`${origin}/healthz`);
  const healthBody = (await health.json()) as { ok?: boolean };
  check(
    "/healthz answers",
    health.status === 200 && healthBody.ok === true,
    `status ${String(health.status)}`,
  );

  const docs = await fetch(`${origin}/api/docs`);
  check(
    "/api/docs renders",
    docs.status === 200 && (docs.headers.get("content-type") ?? "").includes("text/html"),
    `status ${String(docs.status)}, ${docs.headers.get("content-type") ?? "no content-type"}`,
  );

  const spec = await fetch(`${origin}/api/spec.json`);
  const committed = await readFile(join(here, "../../../packages/core/openapi.json"), "utf8");
  check(
    "/api/spec.json is the committed OpenAPI document",
    spec.status === 200 && canonical(await spec.text()) === canonical(committed),
    `status ${String(spec.status)}`,
  );

  // The pair run_worker_first gets wrong silently: both are 200, and only the
  // body says which handler answered.
  const spa = await fetch(`${origin}/issues/DEV-1`);
  const index = await readFile(join(here, "../dist/client/index.html"), "utf8");
  check(
    "/issues/DEV-1 is the SPA",
    spa.status === 200 && (await spa.text()) === index,
    `status ${String(spa.status)}`,
  );

  const issue = await fetch(`${origin}/api/issues/DEV-1`);
  check(
    "/api/issues/DEV-1 is the API",
    (issue.headers.get("content-type") ?? "").includes("application/json") && issue.status === 401,
    `status ${String(issue.status)}, ${issue.headers.get("content-type") ?? "no content-type"}`,
  );

  const unauthenticated = await rpc(origin, "me/get", undefined);
  check(
    "an unauthenticated /rpc call is UNAUTHORIZED, in JSON",
    unauthenticated.status === 401 &&
      unauthenticated.contentType.includes("application/json") &&
      unauthenticated.parsed &&
      unauthenticated.body.includes("UNAUTHORIZED"),
    `status ${String(unauthenticated.status)}, ${unauthenticated.contentType || "no content-type"}${
      unauthenticated.parsed ? "" : ", unparseable"
    }: ${unauthenticated.body.slice(0, 200)}`,
  );

  const mcp = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  check(
    "an unauthenticated POST /mcp is the RFC 9728 challenge, at the configured origin",
    mcp.status === 401 &&
      (mcp.headers.get("www-authenticate") ?? "").includes(
        `resource_metadata="${baseURL}/.well-known/oauth-protected-resource/mcp"`,
      ),
    `status ${String(mcp.status)}, ${mcp.headers.get("www-authenticate") ?? "no challenge"}`,
  );
}

/** Slice 5: a Human signs in with GitHub and lands in the Workspace, on D1. */
async function aHumanSignsIn(origin: string): Promise<void> {
  // The isolate is built by whichever request arrives first, and this phase
  // makes that a request needing no auth on purpose. Better Auth starts
  // initialising in its constructor and workerd abandons the I/O still in
  // flight when the request that began it returns, so unless the Worker
  // finishes that initialisation before answering, the sign-in below awaits a
  // `$context` that never settles and hangs until wrangler closes the socket
  // (apps/web/src/worker.ts). A sign-in that arrives first would build the app
  // and await it inside its own live request, and never see the bug.
  const health = await fetch(`${origin}/healthz`);
  check(
    "a request that needs no auth builds the isolate",
    health.status === 200,
    `status ${String(health.status)}`,
  );

  const admin = await signIn(origin, adminEmail);
  check(
    "the admin email's sign-in mints a session cookie",
    admin.cookie.length > 0 && !admin.location.includes("/api/auth/error"),
    `sent to ${admin.location || "nowhere"}`,
  );

  const members = await rpc(origin, "members/list", {}, admin.cookie);
  const listed = (members.output as { members?: Array<Record<string, unknown>> } | null)?.members;
  check(
    "the admin email's sign-in creates the Workspace and one admin Member on D1",
    members.status === 200 &&
      listed?.length === 1 &&
      listed[0]?.role === "admin" &&
      listed[0]?.kind === "human",
    `status ${String(members.status)}: ${members.body.slice(0, 300)}`,
  );

  const events = await rpc(origin, "events/list", {}, admin.cookie);
  const kinds = ((events.output as { events?: Array<{ kind?: string }> } | null)?.events ?? []).map(
    (event) => event.kind,
  );
  check(
    "it appends workspace.created then member.joined",
    kinds.join(",") === "workspace.created,member.joined",
    `events ${kinds.join(",") || "none"}`,
  );

  // Both hooks run again on the second sign-in, and both are idempotent: the
  // Workspace is created once and the admin joins it once (ADR-0007).
  const again = await signIn(origin, adminEmail);
  check(
    "a second sign-in adds nothing",
    (await membersOn(origin, again.cookie)).length === 1 &&
      (await eventKindsOn(origin, again.cookie)).length === kinds.length,
    "the Workspace or the Event log grew",
  );

  const anonymous = await rpc(origin, "members/list", {});
  check(
    "only the session cookie the Worker minted authenticates /rpc/members.list",
    anonymous.status === 401 && (await membersOn(origin, admin.cookie)).length === 1,
    `an anonymous call was ${String(anonymous.status)}`,
  );

  const rule = await rpc(
    origin,
    "allowlist/add",
    { kind: "email_domain", value: "example.com" },
    admin.cookie,
  );
  if (rule.status !== 200) throw new Error(`the allowlist rule was refused: ${rule.body}`);

  const joined = await whoAmI(origin, await signIn(origin, "bob@example.com"));
  check(
    "a sign-in matching an allowlisted email domain auto-joins",
    joined.user?.email === "bob@example.com" && joined.member?.role === "member",
    JSON.stringify(joined),
  );

  const refused = await whoAmI(origin, await signIn(origin, "carol@example.org"));
  check(
    "a sign-in matching nothing gets a user row and no Member",
    refused.user?.email === "carol@example.org" && refused.member === null,
    JSON.stringify(refused),
  );
}

interface WhoAmI {
  user?: { email?: string };
  member?: { role?: string } | null;
}

/** What deevy says about the Human behind a session: the user row, and the Member or none. */
async function whoAmI(origin: string, session: SignedIn): Promise<WhoAmI> {
  const response = await rpc(origin, "me/get", undefined, session.cookie);
  return (response.output as WhoAmI | null) ?? {};
}

/** The Workspace's Members, as this caller sees them. */
async function membersOn(origin: string, cookie: string): Promise<Array<Record<string, unknown>>> {
  const response = await rpc(origin, "members/list", {}, cookie);
  return (response.output as { members?: Array<Record<string, unknown>> } | null)?.members ?? [];
}

/** Every Event in the Workspace, in order, as this caller sees them. */
async function eventKindsOn(origin: string, cookie: string): Promise<string[]> {
  const response = await rpc(origin, "events/list", {}, cookie);
  const events = (response.output as { events?: Array<{ kind?: string }> } | null)?.events ?? [];
  return events.map((event) => event.kind ?? "");
}

const persistTo = await mkdtemp(join(tmpdir(), "deevy-worker-"));
try {
  await build();
  await run(wrangler, [
    "d1",
    "migrations",
    "apply",
    database,
    "--local",
    "--config",
    config,
    "--persist-to",
    persistTo,
  ]);

  await withServer(
    persistTo,
    { config, port: 0, vars: { BETTER_AUTH_URL: baseURL } },
    theWorkerServesDeevy,
  );

  // A sign-in needs BETTER_AUTH_URL to be the origin the browser actually
  // uses, because that is what the OAuth callback and the session cookie are
  // built from (docs/OPERATIONS.md). So this phase picks the port first, and
  // keeps its own server rather than weakening the one above, whose whole
  // point is a configured origin the request did not arrive on.
  const port = await freePort();
  await withServer(
    persistTo,
    {
      config: await stubbedOutside(),
      port,
      vars: {
        BETTER_AUTH_URL: `http://127.0.0.1:${String(port)}`,
        BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        DEEVY_ADMIN_EMAIL: adminEmail,
        DEEVY_WORKSPACE_NAME: "Acme",
      },
    },
    aHumanSignsIn,
  );

  // Live Documents, which on this deployment are a Durable Object: the one
  // phase that runs one (ADR-0021).
  const roomPort = await freePort();
  await withServer(
    persistTo,
    {
      config: await stubbedOutside(),
      port: roomPort,
      vars: {
        BETTER_AUTH_URL: `http://127.0.0.1:${String(roomPort)}`,
        BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        DEEVY_ADMIN_EMAIL: adminEmail,
        DEEVY_WORKSPACE_NAME: "Acme",
      },
    },
    aDocumentIsLiveOnWorkerd,
  );

  // The Cron Trigger, on the Workspace the sign-in just created. The rows go
  // in while nothing is serving, so one SQLite file has one writer, and the
  // phase reads them back over the API rather than reaching past the Worker.
  await seedSilentRuns(persistTo, 60);
  const cronPort = await freePort();
  await withServer(
    persistTo,
    {
      config: await stubbedOutside(),
      port: cronPort,
      vars: {
        BETTER_AUTH_URL: `http://127.0.0.1:${String(cronPort)}`,
        BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        DEEVY_ADMIN_EMAIL: adminEmail,
        DEEVY_WORKSPACE_NAME: "Acme",
      },
    },
    backgroundWorkOnACronTrigger,
  );

  // The Event log as the SPA reads it, on a stream short enough to reach its
  // limit while the smoke is watching. Its own server for the same reason the
  // others have theirs: a sign-in needs BETTER_AUTH_URL to name the origin.
  const livePort = await freePort();
  await withServer(
    persistTo,
    {
      config: await stubbedOutside(),
      port: livePort,
      vars: {
        BETTER_AUTH_URL: `http://127.0.0.1:${String(livePort)}`,
        BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        DEEVY_ADMIN_EMAIL: adminEmail,
        DEEVY_WORKSPACE_NAME: "Acme",
        DEEVY_STREAM_SECONDS: String(streamSeconds),
      },
    },
    liveUpdatesInsideAWorkersBudget,
  );

  // The milestone itself, on the runtime the milestone is about: a loop
  // outside deevy working an assigned Issue over /mcp with an Agent's API key,
  // and a Human deciding its Gate over /rpc. Its own server for the reason the
  // others have theirs — the elicitation hands back a link built from
  // BETTER_AUTH_URL, and a Human has to be able to open it.
  const loopPort = await freePort();
  await withServer(
    persistTo,
    {
      config: await stubbedOutside(),
      port: loopPort,
      vars: {
        BETTER_AUTH_URL: `http://127.0.0.1:${String(loopPort)}`,
        BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
        GITHUB_CLIENT_ID: "stub-client-id",
        GITHUB_CLIENT_SECRET: "stub-client-secret",
        DEEVY_ADMIN_EMAIL: adminEmail,
        DEEVY_WORKSPACE_NAME: "Acme",
      },
    },
    theAgentLoopOnWorkerd,
  );

  // Slice 9, in two halves that differ only in whether the account has Queues.
  // One receiver serves both, so the counts each phase asserts are the same
  // server's, and the second half is subscribed to a path the first never used.
  const far = await receiver();
  try {
    const queuePort = await freePort();
    await withServer(
      persistTo,
      {
        config: await withQueues(await stubbedOutside()),
        port: queuePort,
        vars: {
          BETTER_AUTH_URL: `http://127.0.0.1:${String(queuePort)}`,
          BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
          GITHUB_CLIENT_ID: "stub-client-id",
          GITHUB_CLIENT_SECRET: "stub-client-secret",
          DEEVY_ADMIN_EMAIL: adminEmail,
          DEEVY_WORKSPACE_NAME: "Acme",
        },
      },
      (origin) => queuesForAnAccountThatHasThem(origin, far),
    );

    // The same build and the same D1, on the configuration a free account
    // deploys: no producer binding, no consumer, and the Cron Trigger as the
    // only thing that carries a delivery anywhere.
    const sweepPort = await freePort();
    await withServer(
      persistTo,
      {
        config: await stubbedOutside(),
        port: sweepPort,
        vars: {
          BETTER_AUTH_URL: `http://127.0.0.1:${String(sweepPort)}`,
          BETTER_AUTH_SECRET: "smoke-secret-that-is-at-least-32-characters",
          GITHUB_CLIENT_ID: "stub-client-id",
          GITHUB_CLIENT_SECRET: "stub-client-secret",
          DEEVY_ADMIN_EMAIL: adminEmail,
          DEEVY_WORKSPACE_NAME: "Acme",
        },
      },
      (origin) => theCronPathAlone(origin, far),
    );
  } finally {
    await far.close();
  }

  await deploysWithoutAQueueBlock();
  await theDeployArtifactIsPinned();
} finally {
  await rm(persistTo, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nthe Worker did not serve deevy:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nthe Worker serves deevy");

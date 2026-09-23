/**
 * A Workspace worth looking at, for a developer with no OAuth App and no
 * GitHub App.
 *
 * Everything here goes through the same doors a person or an Agent would use.
 * Humans sign in through the OAuth stub (apps/web/scripts/stub-oauth.js), so
 * the admin this creates is the one `DEEVY_DEV_STUB_OAUTH=1` signs in as
 * afterwards; Agents get their identity from `agents.create` and their key from
 * `agents.keys.issue`; the records come from a stub Socket, which is a tracker
 * deevy talks to exactly as it will talk to GitHub (ADR-0024). Nothing is
 * inserted by hand.
 *
 *   vp run server#seed            # refuses a database that already has a Project
 *   vp run server#seed -- --force # removes the database file first
 *
 * It reads `.env` like the server does, and it needs DEEVY_ADMIN_EMAIL.
 */
import { existsSync, unlinkSync } from "node:fs";
import { API_PATH } from "@deevy/core";
import { buildContext } from "@deevy/core/app";
import { router } from "@deevy/core/router";
import {
  applyInbound,
  discardingJobQueue,
  routeIssueTo,
  sweepStaleRuns,
  upsertProjection,
} from "@deevy/core";
import {
  addContainer,
  openStubStore,
  putIssue,
  socketModules,
  type StubContainer,
} from "@deevy/sockets";
import { createRouterClient } from "@orpc/server";
import { readEnv, stubbedProviders } from "./env.ts";
import { buildServer } from "./server.ts";

const force = process.argv.includes("--force");
const read = readEnv();
// Every provider is the stub here, whatever the environment configured and
// whatever the flag says — the stub itself is imported below on the same
// grounds. A `.env` with no client pair in it would otherwise leave nothing
// registered for the seed to sign its Humans in with (docs/DEVELOPMENT.md).
// Every provider is the stub here, whatever the environment configured, and
// so is the tracker: the seed's records come from a Socket, and the stub is
// the only provider that needs no App and no network (ADR-0024).
const env = {
  ...read,
  providers: stubbedProviders(read.providers),
  devStubOAuth: true,
  devStubSockets: true,
};
if (!env.adminEmail)
  throw new Error("DEEVY_ADMIN_EMAIL must be set: it names the admin the seed signs in as");
if (!env.baseURL || !env.secret)
  throw new Error("BETTER_AUTH_URL and BETTER_AUTH_SECRET must be set");

if (force && env.databasePath !== ":memory:") {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${env.databasePath}${suffix}`;
    if (existsSync(file)) unlinkSync(file);
  }
}

// Sign-in goes through the stub whatever the flag says: the seed is a
// development tool by definition, and this is its own process.
await import("../../web/scripts/stub-oauth.js");
const { app, db, auth, close } = buildServer(env);
const jobs = discardingJobQueue();

if (await db.query.project.findFirst()) {
  close();
  throw new Error("This database already has a Project; pass --force to replace it");
}

// ------------------------------------------------------------------ callers

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * One Human signing in, as the browser would do it and as the acceptance walk
 * does it (apps/agent/scripts/acceptance.ts).
 *
 * The authorization page itself is not stubbed and could not usefully be: it
 * is where a person would click. What the stub answers is everything after the
 * `code`, and the `code` is the email address — so the seed plays the click by
 * calling the callback with the state the sign-in just minted.
 */
async function signIn(email: string): Promise<string> {
  const start = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/" }),
  });
  const { url } = (await start.json()) as { url?: string };
  const state = url ? (new URL(url).searchParams.get("state") ?? "") : "";
  if (!state) throw new Error(`no authorization URL for ${email}`);
  const finished = await app.request(
    `/api/auth/callback/github?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(start) }, redirect: "manual" },
  );
  const cookie = cookiesOf(finished);
  if (!cookie) throw new Error(`sign-in refused for ${email}`);
  return cookie;
}

/**
 * The tools this seed can speak, which is one: the provider that is not a tool
 * (packages/sockets/src/stub). `buildContext` builds what a request carries and
 * the registry is the entry's, so a caller assembled here passes its own — the
 * same one `buildServer` gave the app above.
 */
const sockets = socketModules({ devStub: true });

async function caller(headers: HeadersInit) {
  // Seeding signs in with a cookie, so the audience decides nothing; the API
  // resource is what a cookie would be spending if it were a bearer.
  const context = await buildContext(db, auth, new Headers(headers), env.baseURL, API_PATH);
  if (!context.member) throw new Error("that credential is not a Member");
  return {
    member: context.member,
    api: createRouterClient(router, {
      context: {
        ...context,
        jobs,
        sockets,
        ...(env.socketSecret ? { socketSecret: env.socketSecret } : {}),
      },
    }),
  };
}

const asHuman = async (email: string) => caller({ cookie: await signIn(email) });
const asAgent = (key: string) => caller({ authorization: `Bearer ${key}` });

// -------------------------------------------------------------------- people

// The fabricated people live at example.com, never at the admin's own domain:
// the seed's Workspace is what screenshots and demos show, and a real domain
// read off an Allowlist rule there is the admin's, not the fiction's (RFC 2606).
const domain = "example.com";
const admin = await asHuman(env.adminEmail);
console.log(`admin       ${env.adminEmail} (@${admin.member.handle ?? "?"})`);

// Anyone at that domain may join, which is how the second Human gets in. The
// admin needs no rule: DEEVY_ADMIN_EMAIL bootstraps the Workspace on its own.
await admin.api.allowlist.add({ kind: "email_domain", value: domain });
const graceEmail = `grace@${domain}`;
const grace = await asHuman(graceEmail);
console.log(`member      ${graceEmail} (@${grace.member.handle ?? "?"})`);
// A third, because a Checkpoint that wants two approvals and excludes the
// Human the work is for needs three people to be reachable at all
// (packages/core/src/checkpoints.ts).
const omarEmail = `omar@${domain}`;
const omar = await asHuman(omarEmail);
console.log(`member      ${omarEmail} (@${omar.member.handle ?? "?"})`);

// ------------------------------------------------------------------- sockets

// One connected tool, played in this process. Everything below reaches it the
// way it will reach a GitHub App: through the Socket, never around it.
const store = openStubStore({ id: "seed", login: "deevy" });
const socket = await admin.api.sockets.connect({
  provider: "stub",
  name: "Example tracker",
  // Its accounts are the ones the seeded Humans sign in with, as github.com's
  // are, so a comment by one of them rules as them (ADR-0025).
  config: { storeId: store.id, signInProvider: "github" },
});
console.log(`socket      ${socket.name} as @${socket.identity.login}`);

const containers: Record<string, StubContainer> = {
  "acme/deevy": addContainer(store, { scopeKey: "acme/deevy", name: "acme/deevy" }),
  "acme/ops": addContainer(store, { scopeKey: "acme/ops", name: "acme/ops" }),
};

// ------------------------------------------------------------------ projects

const dev = await admin.api.projects.create({
  slug: "deevy",
  name: "deevy",
  description: "The product itself: Humans and Agents on the same records.",
  tracker: { socketId: socket.id, scope: { scopeKey: "acme/deevy" } },
  // Bound to a repository as well, so the binding screen shows both halves and
  // a Run has somewhere to push. The stub hands out no credential for it, which
  // is what a Project bound to a tool nobody has connected the code half of
  // looks like (packages/sockets/src/stub).
  forge: { socketId: socket.id, scope: { scopeKey: "acme/deevy", baseBranch: "main" } },
});
const ops = await admin.api.projects.create({
  slug: "operations",
  name: "Operations",
  description: "Keeping the instance, the images and the accounts in order.",
  tracker: { socketId: socket.id, scope: { scopeKey: "acme/ops" } },
});

// -------------------------------------------------------------------- agents

async function agent(name: string, projectIds: string[]) {
  const created = await admin.api.agents.create({ name });
  for (const projectId of projectIds) {
    await admin.api.agents.grants.add({ memberId: created.id, projectId });
  }
  // The key an Agent is created with, the way a Sponsor gets one: `agent.
  // key_issued` is already in the log, and issuing a second here would only
  // seed a Workspace whose Agents each carry a key nothing uses.
  if (!created.key) throw new Error("This instance cannot mint API keys");
  return { created, key: created.key.key, ...(await asAgent(created.key.key)) };
}

const planner = await agent("Planner", [dev.id]);
const builder = await agent("Builder", [dev.id, ops.id]);
await admin.api.agents.update({ memberId: planner.created.id, scheduleMinutes: 60 });
await admin.api.projects.update({ slug: dev.slug, defaultAgentMemberId: builder.created.id });
console.log(`agent       Planner (@${planner.member.handle ?? "?"}), sponsored by the admin`);
console.log(`agent       Builder (@${builder.member.handle ?? "?"}), sponsored by the admin`);

// -------------------------------------------------------------------- records

let opened = 0;

interface Record_ {
  container: keyof typeof containers;
  project: { id: string };
  title: string;
  body?: string;
  labels?: string[];
  state?: "open" | "closed";
  stateName?: string;
  /** The Member deevy routes it to, as a delivery's routing label would. */
  routeTo?: string;
}

/**
 * A record arriving from the tracker, projected the way a delivery projects
 * one. Slice 1 puts `applyInbound` and the `/hooks` route in front of this;
 * what it writes is exactly this row.
 */
async function record(seed: Record_) {
  opened += 1;
  const container = containers[seed.container];
  if (!container) throw new Error(`no container ${seed.container}`);
  const external = putIssue(container, {
    externalId: String(opened),
    key: `${seed.container}#${String(opened)}`,
    url: `https://stub.invalid/${seed.container}/issues/${String(opened)}`,
    title: seed.title,
    body: seed.body ?? null,
    state: seed.state ?? "open",
    stateName: seed.stateName ?? (seed.state === "closed" ? "Done" : "Open"),
    labels: seed.labels ?? [],
    updatedAt: new Date(),
  });
  const { issue } = await upsertProjection(db, {
    projectId: seed.project.id,
    socketId: socket.id,
    external,
  });
  // What a delivery's routing label does: name the Agent deevy hands it to.
  if (seed.routeTo) await routeIssueTo(db, issue.id, seed.routeTo);
  return issue;
}

/** The Run an Agent opens on a record it was routed. */
async function runOn(who: typeof planner, issue: { url: string }) {
  return who.api.runs.start({ issue: issue.url });
}

// Gone quiet: an Agent that started and never came back. This is the first
// record an Agent is given, and it is swept with no grace before any other Run
// exists, because the broom cannot tell one silent Run from another.
const quiet = await record({
  container: "acme/deevy",
  project: dev,
  title: "Prune the shadcn components nobody imports",
  labels: ["frontend", "agent:builder"],
  routeTo: builder.member.id,
});
const quietRun = await runOn(builder, quiet);
await builder.api.runs.postActivity({
  runId: quietRun.id,
  kind: "action",
  body: "Listed the components no route imports.",
});
await sweepStaleRuns({ db, workspaceId: admin.member.workspaceId, silenceMs: -1 });

// Asking a question, and waiting for an answer.
const asking = await record({
  container: "acme/deevy",
  project: dev,
  title: "Assigning work to a group",
  body: "Can a record be routed to more than one Agent at a time?",
  routeTo: builder.member.id,
});
const askingRun = await runOn(builder, asking);
await builder.api.runs.postActivity({
  runId: askingRun.id,
  kind: "thought",
  body: "A routing label names one Agent, so two would need two labels.",
});
await builder.api.runs.postActivity({
  runId: askingRun.id,
  kind: "elicitation",
  body: "Should two routing labels mean two Runs, or should the second be refused?",
});

// Finished, with the evidence linked back to the Run that produced it.
const shipped = await record({
  container: "acme/deevy",
  project: dev,
  title: "Webhook signatures include the delivery id",
  labels: ["backend"],
  routeTo: builder.member.id,
});
const shippedRun = await runOn(builder, shipped);
await builder.api.runs.postActivity({
  runId: shippedRun.id,
  kind: "thought",
  body: "The receiver already sees the id in a header; putting it under the signature makes a replayed body detectable.",
});
await builder.api.links.add({
  issue: shipped.url,
  url: "https://github.com/WeAreNendo/deevy/pull/12",
  title: "Sign the delivery id",
  runId: shippedRun.id,
});
await builder.api.runs.finish({
  runId: shippedRun.id,
  status: "completed",
  summary: "Opened #12: the webhook signature now covers the delivery id.",
});

// Failed, with the error on record.
const broken = await record({
  container: "acme/ops",
  project: ops,
  title: "Run the Workers smoke against a second D1 region",
  routeTo: builder.member.id,
});
const brokenRun = await runOn(builder, broken);
await builder.api.runs.postActivity({
  runId: brokenRun.id,
  kind: "error",
  body: "wrangler exited 1: this account has reached its limit of D1 databases on the free plan.",
});
await builder.api.runs.finish({
  runId: brokenRun.id,
  status: "failed",
  summary: "Could not create a second D1 database: the free plan's limit is reached.",
});

// One the Planner is thinking about, and one nobody has picked up.
const planning = await record({
  container: "acme/deevy",
  project: dev,
  title: "Cursor-based paging on every list operation",
  routeTo: planner.member.id,
});
const planningRun = await runOn(planner, planning);
await planner.api.runs.postActivity({
  runId: planningRun.id,
  kind: "action",
  body: "Read the three list operations that still page by offset.",
});
await record({
  container: "acme/deevy",
  project: dev,
  title: "Keyboard shortcut cheat sheet",
  labels: ["docs"],
});
await record({
  container: "acme/ops",
  project: ops,
  title: "Rotate the image signing key",
  state: "closed",
  stateName: "Done",
});

/*
 * The rest of the backlog, so the Work list is a list rather than a handful
 * and the filters have something to filter. Nothing is routed: this is what a
 * team's tracker looks like on the day they connect it, and what the Agents
 * above are working is the part somebody labelled.
 */
const backlog: Array<[keyof typeof containers, { id: string }, string, string[]?]> = [
  ["acme/deevy", dev, "Cursor paging on the Event log", ["backend"]],
  ["acme/deevy", dev, "The Gate screen on a phone", ["frontend"]],
  ["acme/deevy", dev, "Say which Socket a Ruling came through", ["frontend"]],
  ["acme/deevy", dev, "Retry a webhook that answered 500", ["backend"]],
  ["acme/deevy", dev, "An Agent's key, shown once and never again", ["security"]],
  ["acme/deevy", dev, "Mirror less on a Project that says so", ["backend"]],
  ["acme/deevy", dev, "Sub-issues in the tracker that has no parent", ["backend"]],
  ["acme/deevy", dev, "Drop the second query on the inbox count", ["performance"]],
  ["acme/deevy", dev, "A Proposal longer than the screen", ["frontend"]],
  ["acme/deevy", dev, "Name the Human who rejected, not just the note", ["frontend"]],
  ["acme/deevy", dev, "Poll a tracker that rate-limits us", ["backend"]],
  ["acme/deevy", dev, "The empty state on a Workspace with no Sockets", ["frontend"]],
  ["acme/deevy", dev, "Time a Run spent waiting, on the Run", ["frontend"]],
  ["acme/deevy", dev, "Refuse a Checkpoint nobody could ever pass", ["backend"]],
  ["acme/ops", ops, "Back up the sealing secret with the volume", ["docs"]],
  ["acme/ops", ops, "Alert when a Socket has said nothing for a day"],
  ["acme/ops", ops, "Pin the harness CLIs in the image", ["docs"]],
  ["acme/ops", ops, "Move the nightly image build off the free runner"],
  ["acme/ops", ops, "One D1 per environment, named for it"],
  ["acme/ops", ops, "Rotate the Agent keys the demo Workspace holds", ["security"]],
  ["acme/ops", ops, "Turn the Cron Trigger down out of hours"],
  ["acme/ops", ops, "A runbook for a tracker that goes away"],
];
for (const [container, project, title, labels] of backlog) {
  await record({ container, project, title, ...(labels ? { labels } : {}) });
}

// -------------------------------------------------------------------- gates

// What the Project asks before an Agent goes past a Checkpoint, and one Run
// stopped at it: the ruling screen is the page a seeded Workspace exists to
// show, so it starts with something waiting on a Human (ADR-0020, ADR-0024).
await admin.api.checkpoints.set({
  projectSlug: dev.slug,
  checkpoints: [
    { name: "plan", approvalsRequired: 1 },
    { name: "ship", approvalsRequired: 2, excludeRequester: true },
  ],
});
await planner.api.gates.request({
  runId: planningRun.id,
  checkpoint: "plan",
  proposal: [
    "## What I will do",
    "",
    "Take the three list operations that still page by offset and give each a",
    "cursor over `(changed_at, id)`, which is the pair that is unique.",
    "",
    "- `issues.list` first, because it is the one every screen reads",
    "- then `runs.list` and `events.list`, which share the shape",
    "",
    "No operation changes its name, and the old `offset` keeps working for one",
    "release so nothing breaks while a client catches up.",
  ].join("\n"),
  links: [{ url: "https://github.com/acme/deevy/pull/412", title: "Draft: cursor paging" }],
});

// One a Human already ruled on, in deevy, so the Gate screen has a decided
// Gate to show beside the open one and the Run carried on.
const decided = await record({
  container: "acme/deevy",
  project: dev,
  title: "Sign every mirrored comment with the Run that wrote it",
  routeTo: planner.member.id,
});
const decidedRun = await runOn(planner, decided);
await planner.api.runs.postActivity({
  runId: decidedRun.id,
  kind: "thought",
  body: "The tracker shows deevy's own App as the author, so the Agent has to say who it is.",
});
const decidedGate = await planner.api.gates.request({
  runId: decidedRun.id,
  checkpoint: "plan",
  proposal: [
    "## What I will do",
    "",
    "End every comment deevy writes with the Agent, the Run and `via deevy`, so",
    "a reader of the tracker can tell which Agent said it and go and look.",
  ].join("\n"),
});
await admin.api.gates.approve({ requestId: decidedGate.id, note: "Yes, and keep it to one line." });

// And one a Human ruled on where they read it, which is the other half of
// ADR-0025: a comment on the record, from the GitHub account Grace signs in
// with, through the same door a delivery comes in by. The Ruling is the same
// Ruling, and the record says where it came from.
const outside = await record({
  container: "acme/deevy",
  project: dev,
  title: "Take a ruling from the tracker, not just from deevy",
  routeTo: builder.member.id,
});
const outsideRun = await runOn(builder, outside);
await builder.api.gates.request({
  runId: outsideRun.id,
  checkpoint: "plan",
  proposal: [
    "## What I will do",
    "",
    "Read `/approve` and `/reject <note>` off a comment, check the delivery was",
    "signed and is not a replay, and rule as the Human whose account wrote it.",
  ].join("\n"),
});
const socketRow = await db.query.socket.findFirst({ where: { id: socket.id } });
if (!socketRow) throw new Error("the seeded Socket is gone");
const stubModule = sockets.stub?.({
  config: socketRow.config,
  credentials: {},
  fetch: globalThis.fetch,
  now: () => new Date(),
});
await applyInbound({
  db,
  workspace: { id: admin.member.workspaceId },
  socket: socketRow,
  jobs,
  ...(stubModule?.identityScope ? { identityScope: stubModule.identityScope } : {}),
  events: [
    {
      kind: "ruling",
      scopeKey: "acme/deevy",
      issueExternalId: outside.externalId,
      comment: {
        externalId: "c1",
        url: `${outside.url}#comment-1`,
        body: "/approve Approved from the tracker, where I was reading it anyway.",
        // The stub signs a Human in with their address as their GitHub id
        // (apps/web/scripts/stub-oauth.js), which is what a comment carries.
        author: { login: "grace", id: graceEmail, isBot: false },
        createdAt: new Date(),
      },
      decision: "approved",
      note: "Approved from the tracker, where I was reading it anyway.",
    },
  ],
});

// ----------------------------------------------------------------- delivery

const slack = await admin.api.channels.create({
  name: "#deevy",
  webhookUrl: "https://hooks.slack.com/services/T0000000/B0000000/seeded-and-never-posted",
});
await admin.api.routing.set({
  rules: [
    { notificationKind: "run_finished", projectId: dev.id, channelId: slack.id },
    { notificationKind: "run_awaiting_input", projectId: null, channelId: slack.id },
  ],
});
await admin.api.webhooks.create({
  url: "https://runtime.example/deevy",
  secret: "seed-secret-that-nobody-verifies-0000",
  kinds: ["run.*", "issue.*"],
});

// ------------------------------------------------------------------ summary

const inbox = await admin.api.inbox.unreadCount({});
console.log("");
console.log(`Projects    ${dev.name} and ${ops.name}, both bound to ${socket.name}`);
console.log(`Records     ${String(opened)} projected from the tracker`);
console.log(`Inbox       ${String(inbox.unread)} unread for the admin`);
console.log("");
console.log(
  "Sign in with DEEVY_DEV_STUB_OAUTH=1 as any of the three Humans. The Agents' keys, shown once:",
);
console.log(`  Planner   ${planner.key}`);
console.log(`  Builder   ${builder.key}`);
close();

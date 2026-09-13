/**
 * A Workspace worth looking at, for a developer with no OAuth App.
 *
 * Everything here goes through the same doors a person or an Agent would use.
 * Humans sign in through the OAuth stub (apps/web/scripts/stub-oauth.js), so
 * the admin this creates is the one `DEEVY_DEV_STUB_OAUTH=1` signs in as
 * afterwards; Agents get their identity from `agents.create` and their key from
 * `agents.keys.issue`; and every Issue, Document, comment, Run and Gate ruling
 * is an operation call, so the Event log, the inbox and the Run states fill
 * themselves the way they do in production. Nothing is inserted by hand.
 *
 *   vp run server#seed            # refuses a database that already has a Project
 *   vp run server#seed -- --force # removes the database file first
 *
 * It reads `.env` like the server does, and it needs DEEVY_ADMIN_EMAIL.
 */
import { existsSync, unlinkSync } from "node:fs";
import { buildContext } from "@deevy/core/app";
import { router } from "@deevy/core/router";
import { discardingJobQueue, signInProviders, sweepStaleRuns } from "@deevy/core";
import { createRouterClient } from "@orpc/server";
import { readEnv, stubbedProviders } from "./env.ts";
import { buildServer } from "./server.ts";

const force = process.argv.includes("--force");
const read = readEnv();
// Every provider is the stub here, whatever the environment configured and
// whatever the flag says — the stub itself is imported below on the same
// grounds. A `.env` with no client pair in it would otherwise leave nothing
// registered for the seed to sign its Humans in with (docs/DEVELOPMENT.md).
const env = { ...read, providers: stubbedProviders(read.providers) };
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
 * One Human signing in, exactly as the dev form does it: through whichever
 * provider this instance offers first, because under the stub they all answer
 * and the address in the `code` is what decides who signs in. Naming GitHub
 * here meant a stubbed instance configured with only Google could not be seeded
 * at all (docs/plans/sign-in.md).
 */
async function signIn(email: string): Promise<string> {
  const provider = signInProviders(env)[0]?.id;
  if (!provider) throw new Error("this instance offers no sign-in provider to seed through");
  const started = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, callbackURL: "/" }),
  });
  const { url } = (await started.json()) as { url?: string };
  if (!url) throw new Error(`sign-in did not start for ${email}: ${String(started.status)}`);
  const state = new URL(url).searchParams.get("state") ?? "";
  const callback = await app.request(
    `/api/auth/callback/${provider}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(started) }, redirect: "manual" },
  );
  const cookie = cookiesOf(callback);
  if (!cookie.includes("session_token")) {
    throw new Error(`sign-in refused for ${email}: ${callback.headers.get("location") ?? ""}`);
  }
  return cookie;
}

/** The typed client an operation sees for whoever these headers authenticate. */
async function caller(headers: HeadersInit) {
  const context = await buildContext(db, auth, new Headers(headers), env.baseURL);
  if (!context.member) throw new Error("that credential is not a Member");
  return {
    member: context.member,
    api: createRouterClient(router, { context: { ...context, jobs } }),
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

const platform = await admin.api.teams.create({ name: "Platform" });
await admin.api.teams.addMember({ teamId: platform.id, memberId: admin.member.id });
await admin.api.teams.addMember({ teamId: platform.id, memberId: grace.member.id });

// ------------------------------------------------------------------ projects

const dev = await admin.api.projects.create({
  key: "DEV",
  name: "deevy",
  description: "The product itself: Humans and Agents on the same Issues.",
  teamId: platform.id,
});
const ops = await admin.api.projects.create({
  key: "OPS",
  name: "Operations",
  description: "Keeping the instance, the images and the accounts in order.",
});
// OPS is the team that wants Todo, Doing, Done (docs/PLAN.md).
const opsStates = await admin.api.workflow.update({
  projectKey: "OPS",
  states: [
    { name: "Todo", category: "backlog" },
    { name: "Doing", category: "active" },
    { name: "Done", category: "done" },
  ],
  deleteStates: ops.states.map((state) => state.id),
});
const devState = (name: string) => {
  const found = dev.states.find((state) => state.name === name);
  if (!found) throw new Error(`DEV has no State ${name}`);
  return found;
};
const opsState = (name: string) => {
  const found = opsStates.states.find((state) => state.name === name);
  if (!found) throw new Error(`OPS has no State ${name}`);
  return found;
};

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
console.log(`agent       Planner (@${planner.member.handle ?? "?"}), sponsored by the admin`);
console.log(`agent       Builder (@${builder.member.handle ?? "?"}), sponsored by the admin`);

// -------------------------------------------------------------------- labels

// Colours are the Label swatches of apps/web/src/lib/label-colors.ts, as the form offers them.
const label = async (name: string, color: string, scope: string | null = null) =>
  admin.api.labels.create({ name, color, scope });
const backend = await label("backend", "#6265ed");
const frontend = await label("frontend", "#008fba");
const docs = await label("docs", "#63718f");
const checkout = await label("Checkout rewrite", "#c88b00", "epic");
const agentLoop = await label("Agent loop", "#8f5fc0", "epic");
const high = await label("high", "#d73246", "priority");
const low = await label("low", "#239d6a", "priority");

// ------------------------------------------------------------------- issues

interface Seed {
  title: string;
  description?: string;
  labels?: string[];
  /** The State to end in; Gates on the way are approved by the admin. */
  to?: string;
  assignee?: string | null;
  parent?: string;
  by?: typeof admin;
}

const mention = (member: { handle: string | null }) => `@${member.handle ?? ""}`;

/**
 * What a Human writes when they let an Issue through a Gate. One per Gate,
 * because a note that says the same thing at Intent, Spec and Plan makes three
 * rulings read as one repeated line — which is exactly how it looked.
 */
const notes: Record<string, string[]> = {
  Intent: [
    "The problem is real and the outcome is the right shape. Go and spec it.",
    "Agreed this is worth doing now. The constraints section is what sold me.",
    "Yes — though keep the second open question in view when you write the spec.",
  ],
  Spec: [
    "Requirements read cleanly and the flagged concern is handled. Plan it.",
    "Good. The design covers the failure case I was worried about.",
    "Approved. The alternative you rejected was the one I would have asked about.",
  ],
  Plan: [
    "The order of work is right and the tests prove the thing. Build it.",
    "Files and order both make sense; the migration is in the right slice.",
    "Approved — the third step could be its own Issue later, but not today.",
  ],
  Review: [
    "Read the diff and the Run's own summary. Ship it.",
    "Tests cover the case in the plan. Good to go.",
  ],
};

/** A note for this Gate, varied so a Workspace does not read as one sentence. */
let ruled = 0;
function rulingNote(gate: string): string {
  const forGate = notes[gate] ?? ["Approved."];
  return forGate[ruled++ % forGate.length] ?? "Approved.";
}

/** Walks an Issue forward through DEV's Workflow: a move where allowed, a ruling where a Gate holds it. */
async function advance(key: string, toName: string) {
  const order = dev.states.map((state) => state.name);
  let current = (await admin.api.issues.get({ key })).state;
  while (current.name !== toName) {
    const next = order[order.indexOf(current.name) + 1];
    if (!next) throw new Error(`${key} cannot go past ${current.name}`);
    const issue = current.isGate
      ? await admin.api.gates.approve({ key, note: rulingNote(current.name) })
      : await admin.api.issues.move({ key, stateId: devState(next).id });
    current = issue.state;
  }
}

async function issue(projectKey: "DEV" | "OPS", seed: Seed) {
  const by = seed.by ?? admin;
  const created = await by.api.issues.create({
    projectKey,
    title: seed.title,
    description: seed.description ?? null,
    parentKey: seed.parent ?? null,
  });
  if (seed.labels?.length)
    await by.api.issues.setLabels({ key: created.key, labelIds: seed.labels });
  if (seed.to && projectKey === "DEV") await advance(created.key, seed.to);
  if (seed.to && projectKey === "OPS") {
    await admin.api.issues.move({ key: created.key, stateId: opsState(seed.to).id });
  }
  if (seed.assignee) {
    await admin.api.issues.update({ key: created.key, assigneeMemberId: seed.assignee });
  }
  return created;
}

/** The Run the assignment trigger opened for this Agent on this Issue. */
async function ownRun(who: typeof planner, issueKey: string) {
  const { runs } = await who.api.runs.list({ issueKey });
  const found = runs.find((run) => run.agentMemberId === who.member.id);
  if (!found) throw new Error(`no Run for ${who.member.handle ?? "agent"} on ${issueKey}`);
  return found;
}

// Gone quiet: an Agent that started and never came back. This is the first
// Issue an Agent is assigned, and it is swept with no grace before any other
// Run exists, because the broom cannot tell one silent Run from another:
// every assignment below would open a pending Run it would sweep too. The
// sweep's clock is one millisecond ahead, since a Run is due strictly before
// the cutoff and the Activity above may share its millisecond.
const quiet = await issue("DEV", {
  title: "Prune the shadcn components nobody imports",
  labels: [frontend.id, low.id],
  to: "Build",
  assignee: builder.member.id,
});
const quietRun = await ownRun(builder, quiet.key);
await builder.api.runs.postActivity({
  runId: quietRun.id,
  kind: "thought",
  body: "Listing every file under components/ui and grepping for its import.",
});
await sweepStaleRuns({
  db,
  workspaceId: admin.member.workspaceId,
  silenceMs: 0,
  now: new Date(Date.now() + 1),
});

// The epic, and its children.
const epic = await issue("DEV", {
  title: "Checkout rewrite",
  description:
    "The Checkout flow is three Projects' worth of Issues pretending to be one. This is the umbrella: intent first, then one child per surface.\n\n" +
    "## Why now\n\nEvery Agent Run on Checkout in the last month ended in a question a Human had to answer twice.",
  labels: [checkout.id, high.id],
  assignee: admin.member.id,
});
// The epic's own Documents: what a Human and an Agent actually leave behind at
// Intent and Spec, rather than the State's empty template. A screen is only as
// honest as the fixture under it.
await admin.api.documents.write({
  issueKey: epic.key,
  name: "intent",
  body: [
    "## Problem",
    "",
    "Checkout is four screens and three of them were written for a flow we stopped running in April. Two",
    'Issues a week arrive as "checkout is broken" and each one turns out to be a different screen. Nobody can',
    "say what the flow is supposed to be without reading the code, so every fix is a guess and every Run an",
    "Agent makes on it ends with a question a Human has to answer twice.",
    "",
    "## Proposed outcome",
    "",
    "One flow, described here, with a child Issue per surface: address, payment, review. A Human can read this",
    "Document and know what Checkout does; an Agent can read it and know what it is building against.",
    "",
    "## Affected users and systems",
    "",
    "Everybody who buys anything. `packages/core/src/operations/checkout.ts`, the address form, the payment",
    "intents, and the receipt mail that quotes the order back.",
    "",
    "## Constraints",
    "",
    "- The payment provider's idempotency window is 24 hours; anything we retry after that is a second charge.",
    "- Address validation is a third party and is down often enough to plan for.",
    "- No downtime: the old flow keeps working until the last child Issue is Done.",
    "",
    "## Open questions",
    "",
    '- Is "one child per surface" three Issues or eight? Grace reads it as eight.',
    "- Do we keep guest checkout, or is an account the price of buying?",
  ].join("\n"),
});
// Only now does the Intent Gate get to rule, so the ruling pins the intent as
// written rather than the empty template the State opened with. Writing first
// and approving second is also the order a Workspace works in.
await advance(epic.key, "Spec");
// The spec is the Planner's, so the Issue shows what deevy is actually for: a
// Human writes the intent, an Agent writes the spec against it, and the page
// says which of them wrote what.
await planner.api.documents.write({
  issueKey: epic.key,
  name: "spec",
  body: [
    "## Requirements",
    "",
    "1. A Checkout is one server-side object from the first address keystroke to the receipt. The client holds",
    "   no state the server cannot rebuild.",
    "2. Every payment attempt carries an idempotency key derived from the Checkout id and the attempt number,",
    "   so a retry inside the provider's window is the same charge and outside it is refused rather than",
    "   duplicated.",
    "3. Address validation failing is not checkout failing: the address is kept unvalidated with a warning on",
    "   the review screen.",
    "4. The receipt quotes the order as it was at payment, not as the catalogue is now.",
    "",
    "## Design",
    "",
    "`checkout.create` opens the object and returns its id. `checkout.setAddress`, `checkout.setPayment` and",
    "`checkout.confirm` are the three writes; each appends an Event, so a support question is answered from",
    "the log rather than from a guess. `confirm` is the only one that talks to the provider.",
    "",
    "The three surfaces become three child Issues, and they share nothing but this Document: the address form",
    "can ship before payment is touched.",
    "",
    "## Concerns",
    "",
    "- **Flagged:** the 24-hour idempotency window means a Run that resumes after a Gate has waited overnight",
    "  must re-read the attempt number rather than reuse the key it held. Called out because it is the kind of",
    "  thing that looks fine in review and charges somebody twice in production.",
    "- Guest checkout is still open from the intent, and requirement 1 is written as though the answer is yes.",
  ].join("\n"),
});
// Deliberate, and the case the Gate's version pin exists for: the Intent was
// approved at v2 and the Planner answered one of its open questions afterwards.
// The ruling in the rail should still say v2, and say the text has moved since.
const approvedIntent = await planner.api.documents.get({ issueKey: epic.key, name: "intent" });
await planner.api.documents.write({
  issueKey: epic.key,
  name: "intent",
  body: approvedIntent.body.replace(
    '- Is "one child per surface" three Issues or eight? Grace reads it as eight.',
    "- Three children, one per surface: address, payment, review. Grace read it as eight; the spec settles it.",
  ),
});

await issue("DEV", {
  title: "Checkout: replace the address form with one Field group",
  labels: [checkout.id, frontend.id],
  parent: epic.key,
  to: "Build",
  assignee: builder.member.id,
});
await issue("DEV", {
  title: "Checkout: idempotent payment intents",
  labels: [checkout.id, backend.id, high.id],
  parent: epic.key,
  to: "Plan",
  assignee: planner.member.id,
});
await issue("DEV", {
  title: "Checkout: write down what a refund actually does",
  labels: [checkout.id, docs.id, low.id],
  parent: epic.key,
  by: grace,
});

// Documents with a second version, written by the Agent that owns the State.
const eventLog = await issue("DEV", {
  title: "Ship the Event log view",
  description:
    "The Workspace Event log has no view. Operators read it with sqlite3, which is the honest answer and a bad one.",
  labels: [frontend.id, agentLoop.id],
  assignee: planner.member.id,
});
await planner.api.documents.write({
  issueKey: eventLog.key,
  name: "intent",
  body:
    "# Intent\n\n## Problem\n\nThe Event log is the only record of what happened and nobody can read it without a shell.\n\n" +
    "## Proposed outcome\n\nA table under Settings: seq, time, kind, actor, subject, payload on demand.\n\n" +
    "## Affected users and systems\n\nAdmins. `events.list`, which pages forward only today.\n\n" +
    "## Constraints\n\nD1's per-invocation query budget: one query per page.\n\n## Open questions\n\n- Newest first needs a `before` cursor.\n",
});
await advance(eventLog.key, "Plan");
await planner.api.documents.write({
  issueKey: eventLog.key,
  name: "plan",
  body:
    "# Plan\n\n## Files that change\n\n- `packages/core/src/operations/events.ts` — a `before` input\n- `apps/web/src/routes/settings/events.tsx` — new\n\n" +
    "## Order of work\n\n1. The cursor.\n2. The table.\n3. The filters.\n\n## Tests that prove it\n\n- `events.list({ before })` returns the page below the cursor\n- the table renders newest first\n",
});

await issue("DEV", {
  title: "Four-eyes Gates: a Gate may require two rulings",
  description:
    "PLAN.md's after-v1 list. A Gate that names approvers can already narrow who; this is how many.",
  labels: [backend.id, agentLoop.id],
});
await issue("DEV", {
  title: "Cost and time accounting per Run",
  labels: [backend.id, agentLoop.id, high.id],
  to: "Spec",
  by: grace,
  assignee: grace.member.id,
});
await issue("DEV", {
  title: "Retry webhook deliveries with backoff after a 5xx",
  labels: [backend.id],
  to: "Build",
  assignee: builder.member.id,
});
await issue("DEV", {
  title: "Board cards keep their order inside a column",
  labels: [frontend.id, low.id],
  to: "Build",
});
await issue("DEV", {
  title: "Slack approve buttons in the Gate notification",
  labels: [frontend.id, backend.id],
  to: "Review",
  assignee: admin.member.id,
});
await issue("DEV", {
  title: "An Agent's inbox carries the ruling it is waiting for",
  labels: [agentLoop.id],
  to: "Done",
});
await issue("DEV", {
  title: "Husky runs the checks before they can reach CI",
  labels: [docs.id],
  to: "Done",
});
await issue("DEV", {
  title: "Notification kinds have two audiences, and the types say which",
  labels: [backend.id],
  to: "Done",
});
await issue("DEV", {
  title: "The published image is private, so say so where it is offered",
  labels: [docs.id],
  to: "Done",
  by: grace,
});
await issue("DEV", {
  title: "A Gate says who may rule on it, instead of implying it",
  labels: [backend.id, agentLoop.id],
  to: "Done",
});
await issue("DEV", {
  title: "Email as a Channel",
  labels: [backend.id, low.id],
  by: grace,
});
await issue("DEV", {
  title: "Private Projects",
  labels: [backend.id, frontend.id],
});
await issue("DEV", {
  title: "GitLab and Google sign-in",
  labels: [backend.id],
  to: "Spec",
});
await issue("DEV", {
  title: "A CLI that speaks the same operations",
  labels: [backend.id, low.id],
});

// A Gate that was refused: the Issue is still in Intent, with a decision on record.
const refused = await issue("DEV", {
  title: "Delete an Issue",
  description: "Nothing is deleted in deevy; an Issue is closed. This asks for a real delete.",
  labels: [backend.id],
  by: grace,
});
await admin.api.gates.reject({
  key: refused.key,
  note: "The Event log is the audit trail (PLAN.md). Close it instead, or make the case for tombstones.",
});

// Issues owed a ruling right now, so the inbox has Gates waiting.
await issue("DEV", {
  title: "Postgres as the third storage adapter",
  description: "Drizzle already speaks it; the adapter is the migrator and the driver.",
  labels: [backend.id, high.id],
  to: "Plan",
  assignee: planner.member.id,
});
await issue("DEV", {
  title: "Agent-to-agent delegation through sub-issues",
  labels: [agentLoop.id, high.id],
  to: "Spec",
  by: grace,
});

// OPS: the short workflow.
await issue("OPS", { title: "Rotate the GitHub OAuth App secret", labels: [high.id], to: "Doing" });
await issue("OPS", { title: "Tag v0.5.0 once the release workflow accepts it", to: "Todo" });
await issue("OPS", {
  title: "Extend release.yml's tag pattern past v0.4.*",
  labels: [backend.id],
  to: "Todo",
  assignee: builder.member.id,
});
await issue("OPS", { title: "Move the Worker deploy off a laptop", to: "Todo", by: grace });
await issue("OPS", { title: "Free-tier D1 write budget: measure a busy day", to: "Doing" });
await issue("OPS", { title: "Docker image scanned in CI", to: "Done" });
await issue("OPS", { title: "The migrator refuses a downgrade", to: "Done" });

// ------------------------------------------------------------------ comments

await grace.api.comments.create({
  issueKey: epic.key,
  body: `${mention(admin.member)} the intent reads well, but "one child per surface" is three Issues or eight depending on who counts. Which is it?`,
});
await admin.api.comments.create({
  issueKey: epic.key,
  body: `Three. ${mention(grace.member)} take the refund one; ${mention(planner.member)} has the payment intents.`,
});
await planner.api.comments.create({
  issueKey: eventLog.key,
  body: `Plan v1 is up. ${mention(admin.member)} the open question is the cursor: \`before\` on \`events.list\` or a client that walks back from the stream position.`,
});
await grace.api.comments.create({
  issueKey: refused.key,
  body: `Fair. Reopening as "close with a reason" when I get to it.`,
});

// --------------------------------------------------------------------- runs

// Waiting on a Human's answer.
const asking = await issue("DEV", {
  title: "The Board's Assignee filter should offer Teams",
  labels: [frontend.id],
  to: "Build",
  assignee: builder.member.id,
});
const askingRun = await ownRun(builder, asking.key);
await builder.api.runs.postActivity({
  runId: askingRun.id,
  kind: "thought",
  body: "A Team is not a Member, so `assigneeMemberId` cannot carry it.",
});
await builder.api.runs.postActivity({
  runId: askingRun.id,
  kind: "elicitation",
  body: "Should picking a Team mean 'any of its Members', or should Issues be assignable to a Team? The first is a filter; the second is a schema change.",
});

// Waiting on a Gate: the Planner wrote the plan and asked for the ruling.
const gated = await issue("DEV", {
  title: "Cursor-based paging on every list operation",
  labels: [backend.id],
  to: "Plan",
  assignee: planner.member.id,
});
const gatedRun = await ownRun(planner, gated.key);
await planner.api.runs.postActivity({
  runId: gatedRun.id,
  kind: "action",
  body: "Read the intent and the three list operations that still page by offset.",
});
await planner.api.documents.write({
  issueKey: gated.key,
  name: "plan",
  body: "# Plan\n\n1. `after` on `members.list` and `labels.list`.\n2. `before` on `events.list`.\n3. Drop `limit` defaults above 200.\n",
});
await planner.api.runs.postActivity({
  runId: gatedRun.id,
  kind: "action",
  body: "Wrote plan v2.",
});
await planner.api.runs.requestApproval({ runId: gatedRun.id });

// Finished, with the evidence linked back to the Run that produced it.
const shipped = await issue("DEV", {
  title: "Webhook signatures include the delivery id",
  labels: [backend.id],
  to: "Build",
  assignee: builder.member.id,
});
const shippedRun = await ownRun(builder, shipped.key);
await builder.api.runs.postActivity({
  runId: shippedRun.id,
  kind: "thought",
  body: "The receiver already sees the id in a header; putting it under the signature makes a replayed body detectable.",
});
await builder.api.runs.postActivity({
  runId: shippedRun.id,
  kind: "action",
  body: "Branch deevy/DEV-webhook-delivery-id, three files, tests green.",
});
await builder.api.links.add({
  issueKey: shipped.key,
  url: "https://github.com/mattallty/deevy/pull/12",
  title: "Sign the delivery id",
  runId: shippedRun.id,
});
await builder.api.links.add({
  issueKey: shipped.key,
  url: "https://github.com/mattallty/deevy/tree/deevy/DEV-webhook-delivery-id",
  runId: shippedRun.id,
});
await builder.api.runs.postActivity({
  runId: shippedRun.id,
  kind: "response",
  body: "Opened #12. The signature now covers `delivery.id`; the receiver test in apps/claude-agent asserts it.",
});
await builder.api.runs.finish({
  runId: shippedRun.id,
  status: "completed",
  summary: "Opened #12: the webhook signature now covers the delivery id.",
});
await admin.api.issues.move({ key: shipped.key, stateId: devState("Review").id });

// Failed, with the error on record.
const broken = await issue("DEV", {
  title: "Run the Workers smoke against a second D1 region",
  labels: [backend.id, low.id],
  to: "Build",
  assignee: builder.member.id,
});
const brokenRun = await ownRun(builder, broken.key);
await builder.api.runs.postActivity({
  runId: brokenRun.id,
  kind: "action",
  body: "wrangler d1 create deevy-smoke-eu --location weur",
});
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

// Pending: assigned, not yet picked up.
await issue("DEV", {
  title: "Keyboard shortcut cheat sheet",
  labels: [frontend.id, docs.id],
  to: "Build",
  assignee: builder.member.id,
});

// ----------------------------------------------------------------- delivery

const slack = await admin.api.channels.create({
  name: "#deevy",
  webhookUrl: "https://hooks.slack.com/services/T0000000/B0000000/seeded-and-never-posted",
});
await admin.api.routing.set({
  rules: [
    { notificationKind: "gate_awaiting", projectId: null, channelId: slack.id },
    { notificationKind: "run_finished", projectId: dev.id, channelId: slack.id },
  ],
});
await admin.api.webhooks.create({
  url: "https://runtime.example/deevy",
  secret: "seed-secret-that-nobody-verifies-0000",
  kinds: ["run.*", "gate.*"],
});

// ------------------------------------------------------------------ summary

const inbox = await admin.api.inbox.unreadCount({});
console.log("");
console.log(
  `Projects    DEV (${dev.states.length} States, Gates on Intent, Spec, Plan, Review) and OPS (Todo, Doing, Done)`,
);
console.log(`Inbox       ${String(inbox.unread)} unread for the admin`);
console.log("");
console.log("Sign in with DEEVY_DEV_STUB_OAUTH=1 as either Human. The Agents' keys, shown once:");
console.log(`  Planner   ${planner.key}`);
console.log(`  Builder   ${builder.key}`);
close();

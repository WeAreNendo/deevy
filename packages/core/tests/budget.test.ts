import { account, member as memberTable, memberIdentity, socket as socketTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { sealSecret } from "../src/secrets.ts";
import type { InboundEvent } from "../src/sockets/port.ts";
import {
  agentContext,
  countingDb,
  externalIssue,
  fakeChat,
  memberContext,
  fakeSockets,
  seedProject,
  testSealingSecret,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * D1 caps the statements one Worker invocation may run, and PLAN.md's risks
 * put that cap at 50. Nobody had counted what deevy's busiest write actually
 * spends, so this test does, and it is the same number on both runtimes: the
 * core has no idea which one it is running on (docs/plans/m3.md slice 5).
 */
const d1StatementsPerInvocation = 50;

/**
 * What creating an Issue costs today, measured rather than guessed. It buys the
 * handler's own reads and writes, `openStateDocument`'s Document and first
 * version, and `appendEvent`'s whole tail twice over — once for `issue.created`
 * It is a ratchet, not a target: a change that adds a query to any of those
 * fails here, on Node, long before a Worker invocation runs out of statements.
 * The count is asserted exactly rather than as a ceiling, so the test also
 * fails when it stops counting — a `logger` that changes shape, or a
 * `countingDb` swapped back for `testDb`, leaves the array empty and a ceiling
 * is happy with nothing. A change that genuinely spends fewer statements is
 * welcome and edits this number; one that spends more has to explain itself.
 *
 * It went from 24 to 7 with the Sockets cut (ADR-0024), and the seventeen it
 * stopped spending are all the tracker's now: no Document created beside the
 * Issue and no version row under it, no second `appendEvent` tail for the
 * `document.created` that followed, no State to read and no Gate standing to
 * work out, and no numbering statement. What replaced them costs nothing here,
 * because opening the record is a call to the Socket rather than a write. Then
 * one more for the Checkpoints on the answer: `issues.create` reads the record
 * back the way `issues.get` does, and what a Project asks a Run to stop at is
 * part of that read now (operations/shared.ts).
 */
const budget = 8;

describe(`the D1 request budget: ${String(budget)} statements, under D1's ${String(d1StatementsPerInvocation)}`, () => {
  it("is what creating an Issue with one mention, one Slack Channel and one webhook subscription costs", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await db.update(memberTable).set({ handle: "bob" }).where(eq(memberTable.id, bob.member.id));
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    const channel = await asAda.channels.create({
      name: "#deevy",
      webhookUrl: "https://hooks.slack.example/services/T000/B000/xxx",
    });
    await asAda.routing.set({
      rules: [{ notificationKind: null, projectId: null, channelId: channel.id }],
    });
    await asAda.webhooks.create({
      url: "https://agent.example.test/deevy",
      secret: "whsec_deevy_budget_test",
    });

    statements.length = 0;
    await asAda.issues.create({
      projectSlug: seeded.project.slug,
      title: "Ship the Worker",
      // A Member who exists and is findable by handle. `issues.create` never
      // looks: only `comments.create` resolves mentions, so a mention costs a
      // record nothing on the way in (packages/core/src/mentions.ts).
      body: "@bob, the plan Checkpoint is yours",
    });

    expect(statements.length).toBe(budget);
    expect(budget).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What reading an Issue costs, which is the other busy path: the Issue page
 * asks for it on every visit, and a tree may cross a Project
 * (docs/plans/sub-issue-delegation.md). The number that matters is that it does
 * not grow with the number of children — each child's Project comes back on the
 * relation the query already makes, and a version of this that reads a Project
 * per child would show up here as six statements instead of one.
 */
describe("reading an Issue with children", () => {
  it("costs the same whether it has one child or six", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    const other = await seedProject(db, ada.workspace.id, {
      slug: "operations",
      scopeKey: "acme/ops",
    });
    const parent = await asAda.issues.create({
      projectSlug: seeded.project.slug,
      title: "Checkout rewrite",
    });
    await asAda.issues.create({
      projectSlug: other.project.slug,
      title: "One child",
      parent: parent.url,
    });

    statements.length = 0;
    await asAda.issues.get({ issue: parent.url });
    const withOne = statements.length;

    for (let more = 2; more <= 6; more++) {
      await asAda.issues.create({
        projectSlug: other.project.slug,
        title: `Child ${String(more)}`,
        parent: parent.url,
      });
    }
    statements.length = 0;
    await asAda.issues.get({ issue: parent.url });

    expect(statements.length).toBe(withOne);
    expect(withOne).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What an Agent opening a sub-issue costs. The busiest write deevy has: the
 * handler's own reads, three ceiling walks, and `appendEvent`'s whole tail
 * twice over — `issue.created` and then `issue.assigned`, each paying for
 * notifications, webhook deliveries and the triggers that open the other
 * Agent's Run (docs/plans/sub-issue-delegation.md).
 *
 * A ratchet like the one above, and the one that matters most: it is the path
 * an admin can make more expensive by raising `maxDelegationDepth`, so the
 * deepest legal tree is what it is measured at.
 */
/*
 * Fifty-two when it was written, which is over D1's cap and would have failed
 * on the Worker: the three ceilings walked the tree a row at a time, and the
 * depth an admin may raise multiplied it. Two recursive queries replaced nine,
 * and `startRun` stopped reading back a row it had just inserted. Forty-four
 * until the Sockets cut, which took the Document and its Event tail out of the
 * same write; then one more for the mirror derivation, which reads the
 * Project a `run.started` belongs to before deciding it has nothing to say
 * (sockets/mirror.ts), and one more for the Project's Checkpoints, which the
 * record an Agent reads back carries (operations/shared.ts).
 */
const delegating = 36;

describe(`the D1 request budget: an Agent opening a sub-issue costs ${String(delegating)}`, () => {
  it("stays under D1's cap at the deepest tree the Workspace allows", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    const channel = await asAda.channels.create({
      name: "#deevy",
      webhookUrl: "https://hooks.slack.example/services/T000/B000/xxx",
    });
    await asAda.routing.set({
      rules: [{ notificationKind: null, projectId: null, channelId: channel.id }],
    });
    await asAda.webhooks.create({
      url: "https://agent.example.test/deevy",
      secret: "whsec_deevy_budget_test",
    });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const builder = await agentContext(db, {
      name: "Builder",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });

    // The deepest tree the default ceilings allow: a root and three below it,
    // so the next sub-issue sits where the walks are longest.
    const root = await asAda.issues.create({
      projectSlug: seeded.project.slug,
      title: "Checkout rewrite",
    });
    const one = await asPlanner.issues.create({ parent: root.url, title: "One" });
    const two = await asPlanner.issues.create({ parent: one.url, title: "Two" });

    statements.length = 0;
    await asPlanner.issues.create({
      parent: two.url,
      title: "Three",
      assignAgent: builder.member.id,
    });

    expect(statements.length).toBe(delegating);
    expect(delegating).toBeLessThan(d1StatementsPerInvocation);
  });

  it("costs the same however deep an admin lets a tree go", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    await asAda.workspace.update({ maxDelegationDepth: 8 });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });

    let deepest = await asAda.issues.create({
      projectSlug: seeded.project.slug,
      title: "Checkout rewrite",
    });
    for (let deeper = 1; deeper <= 7; deeper++) {
      deepest = await asPlanner.issues.create({
        parent: deepest.url,
        title: `Level ${String(deeper)}`,
      });
    }

    statements.length = 0;
    await asPlanner.issues.create({ parent: deepest.url, title: "Deepest" });

    // The whole reason the walks are two recursive queries rather than a loop:
    // `maxDelegationDepth` is a number the Settings screen invites an admin to
    // raise, and raising it used to multiply the statements on this write until
    // the Worker deployment refused it.
    expect(statements.length).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What one delivery costs, which is the number a Worker lives or dies by.
 *
 * An inbound delivery is a write like any other and is counted like one: the
 * Socket read, the replay claim, the projection, `appendEvent`'s whole tail
 * twice over — `issue.created` and then `issue.assigned`, which opens the Run —
 * and the two rows the route closes with. A burst of records is many
 * invocations and never one, because the page is what bounds a poll and the
 * provider is what bounds a hook.
 */
const delivery = 24;

describe(`the D1 request budget: one delivery that opens a Run costs ${String(delivery)}`, () => {
  it("is under D1's cap for the record a routing label names an Agent on", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const secret = "a-secret-the-tracker-and-deevy-share";
    const seeded = await seedProject(db, ada.workspace.id, { webhookSecret: secret });
    await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const { sockets } = fakeSockets();
    const app = createApp({ db, sockets, socketSecret: testSealingSecret });
    const events: InboundEvent[] = [
      {
        kind: "issue",
        scopeKey: "acme/deevy",
        issue: externalIssue({ externalId: "42", labels: ["agent:planner"] }),
        actor: { login: "ada-on-github", id: "gh-1", isBot: false },
      },
    ];
    const body = JSON.stringify({ events });

    statements.length = 0;
    const response = await app.request(`/hooks/${seeded.socketId}`, {
      method: "POST",
      headers: {
        "x-test-event": "events",
        "x-test-delivery": "delivery-1",
        "x-test-signature": `${secret}:${String(body.length)}`,
      },
      body,
    });

    expect(await response.json()).toMatchObject({ status: "applied" });
    expect(statements.length).toBe(delivery);
    expect(delivery).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What a Ruling from the tracker costs, the first time its author is seen
 * (ADR-0025).
 *
 * The delivery's own rows, the record and its open Gate, the Identity looked
 * up and — the first time — found through the account the Human signs in with,
 * written down and said in the log; then `recordRuling`'s whole cost as the web
 * pays it. Every later comment by the same Human skips the account read, the
 * write and its Event. Then one more, from slice 10: a Ruling changes what the
 * Gate's chat messages should say, so it asks where there are any
 * (sockets/chat-out.ts).
 */
const rulingFromTracker = 31;

describe(`the D1 request budget: a Ruling from the tracker costs ${String(rulingFromTracker)}`, () => {
  it("is under D1's cap the first time deevy meets the account", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await db.insert(account).values({
      id: newId("account"),
      accountId: "1002",
      providerId: "github",
      userId: bob.member.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const secret = "a-secret-the-tracker-and-deevy-share";
    const seeded = await seedProject(db, ada.workspace.id, { webhookSecret: secret });
    await db
      .update(socketTable)
      .set({ config: { signInProvider: "github" } })
      .where(eq(socketTable.id, seeded.socketId));
    const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asPlanner = createRouterClient(router, { context: planner });
    const run = await asPlanner.runs.start({ issue: issue.url });
    await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });
    const { sockets } = fakeSockets();
    const app = createApp({ db, sockets, socketSecret: testSealingSecret });
    const events: InboundEvent[] = [
      {
        kind: "ruling",
        scopeKey: "acme/deevy",
        issueExternalId: "42",
        comment: {
          externalId: "c1",
          url: "https://github.test/acme/deevy/issues/42#c1",
          body: "/approve",
          author: { login: "bob", id: "1002", isBot: false },
          createdAt: new Date(),
        },
        decision: "approved",
        note: null,
      },
    ];
    const body = JSON.stringify({ events });

    statements.length = 0;
    const response = await app.request(`/hooks/${seeded.socketId}`, {
      method: "POST",
      headers: {
        "x-test-event": "events",
        "x-test-delivery": "delivery-1",
        "x-test-signature": `${secret}:${String(body.length)}`,
      },
      body,
    });

    expect(await response.json()).toMatchObject({ status: "applied" });
    expect(statements.length).toBe(rulingFromTracker);
    expect(rulingFromTracker).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What a Slack click that rules costs (ADR-0025), which matters more than most
 * because Slack wants its answer within three seconds, on a Worker that may be
 * cold.
 *
 * The request's own row and its outcome, the Gate, the Identity, then
 * `recordRuling` as the web pays it — including the one read of where the
 * Gate's chat messages are, which owes this click's own message its update
 * through the outbox rather than changing it inline.
 */
const slackClick = 24;

describe(`the D1 request budget: a Slack click that rules costs ${String(slackClick)}`, () => {
  it("is under D1's cap, and changes nothing in Slack on the way", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const grace = await memberContext(db, { name: "Grace", email: "grace@example.com" });
    const seeded = await seedProject(db, ada.workspace.id);
    const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const signing = "a-slack-signing-secret-for-tests";
    const slackId = newId("socket");
    await db.insert(socketTable).values({
      id: slackId,
      workspaceId: ada.workspace.id,
      provider: "slack",
      capabilities: ["chat"],
      name: "Acme Slack",
      identity: { login: "deevy", id: "U0DEEVY", mentionHandle: "@deevy" },
      config: { teamId: "T0TEST" },
      webhookSecret: await sealSecret(testSealingSecret, signing),
    });
    await db.insert(memberIdentity).values({
      id: newId("memberIdentity"),
      workspaceId: ada.workspace.id,
      memberId: grace.member.id,
      provider: "slack",
      instance: "T0TEST",
      externalUserId: "U0GRACE",
      externalLogin: "grace",
      verifiedBy: "link_code",
    });
    const asPlanner = createRouterClient(router, { context: planner });
    const run = await asPlanner.runs.start({ issue: issue.url });
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Go",
    });
    const chat = fakeChat();
    const app = createApp({ db, sockets: chat.sockets, socketSecret: testSealingSecret });
    const body = JSON.stringify({
      kind: "ruling",
      actor: { team: "T0TEST", user: "U0GRACE", login: "grace" },
      gateRequestId: gate.id,
      decision: "approved",
      note: null,
      wantsNote: false,
      message: { channel: "C0DEEVY", ts: "1.000100" },
      responseUrl: "https://hooks.slack.test/actions/1",
      triggerId: null,
    });

    statements.length = 0;
    const answered = await app.request(`/hooks/${slackId}`, {
      method: "POST",
      headers: {
        "x-test-event": "block_actions",
        "x-test-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-test-signature": `${signing}:${String(body.length)}`,
      },
      body,
    });

    expect(answered.status).toBe(200);
    expect(chat.updated).toEqual([]);
    expect(statements.length).toBe(slackClick);
    expect(slackClick).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What asking to pass a Checkpoint costs, and what ruling on it costs.
 *
 * Both are ordinary writes with `appendEvent`'s tail on them, and both are on
 * the path a Worker serves: the ask is an MCP tool call and the ruling is a
 * click. The ask pays for the request row, the elicitation Activity, the Run's
 * move and two Events; the ruling pays for the policy, the decision row, the
 * Event and the Run resuming with a third — and, since the Slack app, one read
 * of where the Gate's chat messages are, which a Gate posted nowhere answers
 * with nothing (sockets/chat-out.ts). Since the first real GitHub walk the ask
 * also reads whether this exact Proposal was already approved on the record,
 * which is how an approval that stands is carried rather than asked twice.
 */
const asking = 20;
const ruling = 20;

describe(`the D1 request budget: a Gate costs ${String(asking)} to ask and ${String(ruling)} to rule`, () => {
  it("stays well under D1's cap on both halves", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const seeded = await seedProject(db, ada.workspace.id);
    const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asPlanner = createRouterClient(router, { context: planner });
    const asBob = createRouterClient(router, { context: bob });
    const run = await asPlanner.runs.start({ issue: issue.url });

    statements.length = 0;
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Rewrite the totals, behind a flag.",
    });
    expect(statements.length).toBe(asking);

    statements.length = 0;
    await asBob.gates.approve({ requestId: asked.id, note: "Reads right" });

    expect(statements.length).toBe(ruling);
    expect(ruling).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * The Runs feed reads a page and what the page needs in a fixed number of
 * statements, however many Runs the page has: the last Activities, the Gates
 * waited at, and what each Run spent are one statement each for the whole
 * page (docs/plans/run-usage.md). A statement per Run would show here as a
 * page of three costing more than a page of one.
 */
// The page, its last Activities, its open Gates, and — since
// docs/plans/run-usage.md — what each Run spent.
const listingRuns = 4;

describe(`the Runs feed: ${String(listingRuns)} statements a page`, () => {
  it("costs the same for one Run as for three, what they spent included", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const seeded = await seedProject(db, ada.workspace.id);
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asPlanner = createRouterClient(router, { context: planner });
    const asAda = createRouterClient(router, { context: ada });
    for (const externalId of ["1", "2", "3"]) {
      const issue = await seeded.record({ externalId, title: `Record ${externalId}` });
      const run = await asPlanner.runs.start({ issue: issue.url });
      await asPlanner.runs.reportUsage({
        runId: run.id,
        report: "session-1",
        harness: "claude-code",
        models: [{ model: "m", inputTokens: 10, outputTokens: 10, costUsd: 0.01 }],
      });
    }

    statements.length = 0;
    await asAda.runs.list({ limit: 1 });
    const one = statements.length;
    statements.length = 0;
    const page = await asAda.runs.list({});

    expect(page.runs).toHaveLength(3);
    expect(statements.length).toBe(one);
    expect(one).toBe(listingRuns);
  });
});

describe("an Agent's months: 2 statements, however many Runs", () => {
  it("reads the Agent and then every month's totals in one grouped statement", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const seeded = await seedProject(db, ada.workspace.id);
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asPlanner = createRouterClient(router, { context: planner });
    const asAda = createRouterClient(router, { context: ada });
    for (const externalId of ["1", "2", "3"]) {
      const issue = await seeded.record({ externalId, title: `Record ${externalId}` });
      await asPlanner.runs.start({ issue: issue.url });
    }

    statements.length = 0;
    await asAda.agents.usage({ memberId: planner.member.id, months: 12 });

    expect(statements.length).toBe(2);
  });
});

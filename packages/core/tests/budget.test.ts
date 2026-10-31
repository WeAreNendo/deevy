import { account, issue as issueTable, memberIdentity, socket as socketTable } from "@deevy/db";
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
 * Each budget below is a ratchet, not a target: a change that adds a query to
 * a path fails here, on Node, long before a Worker invocation runs out of
 * statements. The count is asserted exactly rather than as a ceiling, so a test
 * also fails when it stops counting — a `logger` that changes shape, or a
 * `countingDb` swapped back for `testDb`, leaves the array empty and a ceiling
 * is happy with nothing. A change that genuinely spends fewer statements is
 * welcome and edits the number; one that spends more has to explain itself.
 *
 * Opening an Issue and opening a sub-issue had budgets of their own until deevy
 * stopped opening records (docs/plans/simplify.md, slice 4): an Agent opens
 * them in the tracker now, and what that costs deevy is the delivery below.
 */

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
    const parent = await seeded.record({ externalId: "1", title: "Checkout rewrite" });
    // In another tracker, so the link is deevy's own row rather than the
    // tracker's parent field, which only names a record in the same tool.
    const childOf = async (title: string, externalId: string) => {
      const child = await other.record({ externalId, title });
      await db.update(issueTable).set({ parentId: parent.id }).where(eq(issueTable.id, child.id));
    };
    await childOf("One child", "c1");

    statements.length = 0;
    await asAda.issues.get({ issue: parent.url });
    const withOne = statements.length;

    for (let more = 2; more <= 6; more++) {
      await childOf(`Child ${String(more)}`, `c${String(more)}`);
    }
    statements.length = 0;
    await asAda.issues.get({ issue: parent.url });

    expect(statements.length).toBe(withOne);
    expect(withOne).toBeLessThan(d1StatementsPerInvocation);
  });
});

/**
 * What one delivery costs, which is the number a Worker lives or dies by.
 *
 * An inbound delivery is a write like any other and is counted like one: the
 * Socket read, the replay claim, the projection, `appendEvent`'s whole tail
 * twice over — `issue.created` and then `issue.assigned`, which opens the Run —
 * and the two rows the route closes with. A burst of records is many
 * invocations and never one, because the provider is what bounds a hook.
 *
 * Twenty-four until a Socket only announced Gates (docs/plans/simplify.md,
 * slice 4): the `run.started` the delivery causes used to read its Project to
 * learn whether it mirrored Runs, and now nothing about a Run is said on the
 * record, so the kind alone says there is nothing to owe.
 */
const delivery = 23;

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
 * (sockets/chat-out.ts). One fewer since a settled Gate resumes its Run from
 * the row read with the Gate rather than reading the Run again (gates.ts).
 */
const rulingFromTracker = 30;

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
 * through the outbox rather than changing it inline. Like the tracker's, one
 * fewer since the Run resumes from the row read with the Gate.
 */
const slackClick = 23;

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
 * And since a Gate says when it is left short of Humans who could approve it,
 * the ask reads the Workspace's active Humans once for its answer; the
 * ruling's answer does not, because the approval that settles a Gate leaves
 * nothing open to be short. And the ruling no longer reads the Run it resumes:
 * the Gate was read with it.
 */
const asking = 21;
const ruling = 19;

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
 * statements, however many Runs the page has: the last Activities and the
 * Gates waited at are one statement each for the whole page, and how long
 * each Run took is read off its own row. A statement per Run would show here
 * as a page of three costing more than a page of one.
 */
// The page, its last Activities and its open Gates. Four while it also read
// what each Run spent (docs/plans/run-usage.md), which deevy no longer takes
// (docs/plans/simplify.md, slice 3).
const listingRuns = 3;

describe(`the Runs feed: ${String(listingRuns)} statements a page`, () => {
  it("costs the same for one Run as for three", async () => {
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
    await asAda.runs.list({ limit: 1 });
    const one = statements.length;
    statements.length = 0;
    const page = await asAda.runs.list({});

    expect(page.runs).toHaveLength(3);
    expect(statements.length).toBe(one);
    expect(one).toBe(listingRuns);
  });
});

/**
 * Saving a Project's Checkpoints reads the Project, the active Humans it checks
 * the policy against and the rows it changes, changes each in place, appends
 * its Event, and — where a save lowers Approvals — reads the open Gates of the
 * lowered Checkpoints once, with their Rulings and Runs, then the list it
 * answers with. Removing a row, clearing who may rule, naming Humans and
 * adding a Checkpoint cost a statement each only where a save does them. A
 * Gate that passes then pays for its own writes; one that does not costs
 * nothing more, so many of them waiting is the same save as one.
 */
const savingCheckpoints = 8;

describe(`saving Checkpoints: ${String(savingCheckpoints)} statements, however many Gates are open`, () => {
  async function lowering(gates: number) {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await memberContext(db, { name: "Carol", email: "carol@example.com" });
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
    const ship = (approvalsRequired: number) =>
      asAda.checkpoints.set({
        projectSlug: seeded.project.slug,
        checkpoints: [{ name: "ship", approvalsRequired }],
      });
    await ship(3);
    for (let at = 1; at <= gates; at += 1) {
      const issue = await seeded.record({ externalId: String(at), title: `Record ${String(at)}` });
      const run = await asPlanner.runs.start({ issue: issue.url });
      await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });
    }

    statements.length = 0;
    // Lowered, to more than any of them has, so every one is read and none passes.
    await ship(2);
    return statements.length;
  }

  it("reads the open Gates of a lowered Checkpoint once, not once a Gate", async () => {
    const one = await lowering(1);
    expect(await lowering(3)).toBe(one);
    expect(one).toBe(savingCheckpoints);
    expect(savingCheckpoints).toBeLessThan(d1StatementsPerInvocation);
  });
});

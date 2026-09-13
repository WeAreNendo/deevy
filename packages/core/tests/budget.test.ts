import { member as memberTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, countingDb, memberContext } from "./helpers.ts";

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
 * and again for the `document.created` that follows it, each paying for
 * `deriveNotifications` with its routing reads and `deriveWebhookDeliveries`.
 *
 * It is a ratchet, not a target: a change that adds a query to any of those
 * fails here, on Node, long before a Worker invocation runs out of statements.
 * The count is asserted exactly rather than as a ceiling, so the test also
 * fails when it stops counting — a `logger` that changes shape, or a
 * `countingDb` swapped back for `testDb`, leaves the array empty and a ceiling
 * is happy with nothing. A change that genuinely spends fewer statements is
 * welcome and edits this number; one that spends more has to explain itself.
 *
 * It went from 22 to 24 when a Gate gained a standing (docs/plans/four-eyes-gates.md
 * slice 3): the Issue an Agent or a Human is looking at says how many Humans
 * must approve, how many could, and whether the reader is one of them, and the
 * two statements are the two eligibility questions — the approvers this Gate
 * names, and the Humans of the Workspace who are not suspended. The rulings
 * themselves cost nothing extra, because the Issue page already loads them for
 * its history. An Issue in a State that is not a Gate asks neither question.
 */
const budget = 24;

describe(`the D1 request budget: ${String(budget)} statements, under D1's ${String(d1StatementsPerInvocation)}`, () => {
  it("is what creating an Issue with one mention, one Slack Channel and one webhook subscription costs", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await db.update(memberTable).set({ handle: "bob" }).where(eq(memberTable.id, bob.member.id));
    const asAda = createRouterClient(router, { context: ada });
    const project = await asAda.projects.create({ name: "deevy", key: "DEV" });
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
      projectKey: project.key,
      title: "Ship the Worker",
      // A Member who exists and is findable by handle. `issues.create` never
      // looks: only `issues.update` and `comments.create` resolve mentions, so
      // a mention costs an Issue nothing on the way in and two queries on the
      // next edit (packages/core/src/mentions.ts).
      description: "@bob, the Intent Gate is yours",
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
    const asAda = createRouterClient(router, { context: ada });
    await asAda.projects.create({ name: "deevy", key: "DEV" });
    await asAda.projects.create({ name: "Operations", key: "OPS" });
    await asAda.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    await asAda.issues.create({ projectKey: "OPS", title: "One child", parentKey: "DEV-1" });

    statements.length = 0;
    await asAda.issues.get({ key: "DEV-1" });
    const withOne = statements.length;

    for (let more = 2; more <= 6; more++) {
      await asAda.issues.create({
        projectKey: "OPS",
        title: `Child ${String(more)}`,
        parentKey: "DEV-1",
      });
    }
    statements.length = 0;
    await asAda.issues.get({ key: "DEV-1" });

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
 * and `startRun` stopped reading back a row it had just inserted.
 */
const delegating = 44;

describe(`the D1 request budget: an Agent opening a sub-issue costs ${String(delegating)}`, () => {
  it("stays under D1's cap at the deepest tree the Workspace allows", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const project = await asAda.projects.create({ name: "deevy", key: "DEV" });
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
      grants: [project.id],
    });
    const builder = await agentContext(db, {
      name: "Builder",
      sponsor: ada.member,
      grants: [project.id],
    });
    const asPlanner = createRouterClient(router, { context: planner });

    // The deepest tree the default ceilings allow: a root and three below it,
    // so the next sub-issue sits where the walks are longest.
    await asAda.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    await asPlanner.issues.create({ projectKey: "DEV", title: "One", parentKey: "DEV-1" });
    await asPlanner.issues.create({ projectKey: "DEV", title: "Two", parentKey: "DEV-2" });

    statements.length = 0;
    await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Three",
      parentKey: "DEV-3",
      assigneeMemberId: builder.member.id,
    });

    expect(statements.length).toBe(delegating);
    expect(delegating).toBeLessThan(d1StatementsPerInvocation);
  });

  it("costs the same however deep an admin lets a tree go", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const project = await asAda.projects.create({ name: "deevy", key: "DEV" });
    await asAda.workspace.update({ maxDelegationDepth: 8 });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: ada.member,
      grants: [project.id],
    });
    const asPlanner = createRouterClient(router, { context: planner });

    await asAda.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    for (let deeper = 1; deeper <= 7; deeper++) {
      await asPlanner.issues.create({
        projectKey: "DEV",
        title: `Level ${String(deeper)}`,
        parentKey: `DEV-${String(deeper)}`,
      });
    }

    statements.length = 0;
    await asPlanner.issues.create({ projectKey: "DEV", title: "Deepest", parentKey: "DEV-8" });

    // The whole reason the walks are two recursive queries rather than a loop:
    // `maxDelegationDepth` is a number the Settings screen invites an admin to
    // raise, and raising it used to multiply the statements on this write until
    // the Worker deployment refused it.
    expect(statements.length).toBeLessThan(d1StatementsPerInvocation);
  });
});

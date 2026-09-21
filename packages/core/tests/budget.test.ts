import { member as memberTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, countingDb, memberContext, fakeSockets, seedProject } from "./helpers.ts";

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
 * because opening the record is a call to the Socket rather than a write.
 */
const budget = 7;

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
 * same write.
 */
const delegating = 34;

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

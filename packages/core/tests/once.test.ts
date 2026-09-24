import {
  channel as channelTable,
  routingRule,
  webhookSubscription,
  type Db,
  type Event,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { deriveNotifications } from "../src/notifications.ts";
import { deriveWebhookDeliveries } from "../src/webhooks.ts";
import { deliverWebhook, remindAboutGates } from "../src/work.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";
import { newId } from "../src/ids.ts";

/**
 * At most one outbound attempt owed per destination per Event, and one inbox
 * row per Member per kind per Event (docs/plans/m3.md). The invariant is the
 * schema's rather than the caller's: a derivation that runs a second time — a
 * retried request, a queue that delivered its message twice — owes nothing new.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "whsec_deevy_test_secret";

/**
 * Alice, a Project bound to a tracker Socket, and a URL that asked to hear
 * about everything.
 */
async function workspace() {
  const { db, close } = testDb();
  closers.push(close);
  const alice = await memberContext(db, { role: "admin", name: "Alice" });
  const { sockets } = fakeSockets();
  const asAlice = createRouterClient(router, { context: { ...alice, sockets } });
  const { project } = await seedProject(db, alice.workspace.id);
  const subscriptionId = newId("webhook");
  await db.insert(webhookSubscription).values({
    id: subscriptionId,
    workspaceId: alice.workspace.id,
    url: "https://runtime.example/deevy",
    secret,
    kinds: null,
    projectId: null,
    createdBy: alice.member.id,
  });
  return { db, alice, asAlice, project, subscriptionId, workspaceId: alice.workspace.id };
}

/** A Slack Channel the Workspace sends everything to. */
async function slackRoom(db: Db, workspaceId: string) {
  const channelId = newId("channel");
  await db.insert(channelTable).values({
    id: channelId,
    workspaceId,
    kind: "slack",
    name: "#deevy",
    config: { webhookUrl: "https://hooks.slack.example/services/T000/B000/xxx" },
  });
  await db.insert(routingRule).values({
    id: newId("routingRule"),
    workspaceId,
    notificationKind: null,
    projectId: null,
    channelId,
  });
  return channelId;
}

/** The deliveries one Event owes a subscribed URL. */
async function webhooksFor(db: Db, event: Event) {
  return (await db.query.delivery.findMany()).filter(
    (row) => row.target === "webhook" && row.eventSeq === event.seq,
  );
}

/** The messages one Event owes Slack, whichever room they are for. */
async function slackFor(db: Db, event: Event) {
  return (await db.query.delivery.findMany()).filter(
    (row) => row.target === "slack" && row.eventSeq === event.seq,
  );
}

describe("deriving the same Event a second time", () => {
  it("leaves the one Notification it already owed", async () => {
    const { db, alice, asAlice, project } = await workspace();
    // Routing is what assigns a projection now, and deevy states it by opening
    // the record with the Agent's label on it (ADR-0024).
    const planner = await agentContext(db, { sponsor: alice.member, grants: [project.id] });
    await asAlice.issues.create({
      projectSlug: "deevy",
      title: "Ship the thing",
      assignAgent: planner.member.id,
    });
    const assigned = (await db.query.event.findFirst({
      where: { kind: "issue.assigned" },
    })) as Event;
    // The write derived this once already (appendEvent's tail), so the call
    // below is the second run and not the first.
    const first = await db.query.notification.findMany({ where: { eventId: assigned.seq } });
    expect(first).toHaveLength(1);

    await deriveNotifications(db, assigned);

    const owed = await db.query.notification.findMany({ where: { eventId: assigned.seq } });
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ recipientMemberId: planner.member.id, kind: "assignment" });
    expect(owed[0]?.id).toBe(first[0]?.id);
  });

  it("leaves the one delivery the subscribed URL was already owed", async () => {
    const { db, asAlice, subscriptionId } = await workspace();
    await asAlice.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const created = (await db.query.event.findFirst({
      where: { kind: "issue.created" },
    })) as Event;
    const first = await webhooksFor(db, created);
    expect(first).toHaveLength(1);

    await deriveWebhookDeliveries(db, created);

    const owed = await webhooksFor(db, created);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ targetId: subscriptionId, attempts: 0 });
    expect(owed[0]?.id).toBe(first[0]?.id);
  });

  it("leaves the one message the Slack Channel was already owed", async () => {
    const { db, alice, asAlice, project } = await workspace();
    const channelId = await slackRoom(db, alice.workspace.id);
    // A room is full of Humans, so the Event has to be one a Human is owed:
    // a Run asking its Sponsor something (docs/plans/m3.md, slice 2).
    const agent = await agentContext(db, { sponsor: alice.member, grants: [project.id] });
    const asAgent = createRouterClient(router, { context: agent });
    const issue = await asAlice.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const run = await asAgent.runs.start({ issue: issue.externalKey });
    await asAgent.runs.postActivity({
      runId: run.id,
      kind: "elicitation",
      body: "Which base branch should this go to?",
    });
    const asked = (await db.query.event.findFirst({
      where: { kind: "run.awaiting_input" },
    })) as Event;
    const first = await slackFor(db, asked);
    expect(first).toHaveLength(1);

    await deriveNotifications(db, asked);

    const owed = await slackFor(db, asked);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ targetId: channelId, attempts: 0 });
    expect(owed[0]?.id).toBe(first[0]?.id);
  });
});

describe("asking again about a Run nobody has answered", () => {
  it("leaves the Slack Channel the one message that Event already owed", async () => {
    const { db, alice, asAlice, project } = await workspace();
    await slackRoom(db, alice.workspace.id);
    const agent = await agentContext(db, { sponsor: alice.member, grants: [project.id] });
    const asAgent = createRouterClient(router, { context: agent });
    const issue = await asAlice.issues.create({
      projectSlug: "deevy",
      title: "Waiting on a Human",
    });
    const run = await asAgent.runs.start({ issue: issue.url });
    await asAgent.runs.postActivity({
      runId: run.id,
      kind: "elicitation",
      body: "Which base branch should this go to?",
    });
    const asked = (await db.query.event.findFirst({
      where: { kind: "run.awaiting_input" },
    })) as Event;
    const owed = await slackFor(db, asked);
    expect(owed).toHaveLength(1);

    // Five hours of silence, well past the four the sweep waits for.
    const reminded = await remindAboutGates({
      db,
      workspaceId: alice.workspace.id,
      now: new Date(Date.now() + 5 * 60 * 60 * 1000),
    });

    // The reminder re-derives the Gate's Notification, and the room is owed
    // one message per Event whoever asks for it: a Human being asked again is
    // not a second thing happening in the Workspace (docs/plans/m3.md, slice 2).
    expect(reminded).toMatchObject({ scanned: 1, changed: 1 });
    const after = await slackFor(db, asked);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(owed[0]?.id);
  });
});

/** A fetch that never leaves the process, and remembers every POST it was given. */
function stubFetch() {
  const posted: string[] = [];
  return {
    posted,
    fetch: async (_url: string, init: RequestInit) => {
      posted.push(init.body as string);
      return new Response("", { status: 200 });
    },
  };
}

describe("sending the same delivery a second time", () => {
  it("makes no request at all, because the row already landed", async () => {
    const { db, asAlice } = await workspace();
    await asAlice.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const [owed] = (await db.query.delivery.findMany()).filter((row) => row.target === "webhook");
    const receiver = stubFetch();
    const first = await deliverWebhook({
      db,
      deliveryId: owed?.id as string,
      fetch: receiver.fetch,
    });
    expect(first).toMatchObject({ scanned: 1, delivered: 1 });
    const [sent] = (await db.query.delivery.findMany()).filter((row) => row.target === "webhook");

    const second = await deliverWebhook({
      db,
      deliveryId: owed?.id as string,
      fetch: receiver.fetch,
    });

    // A queue is at-least-once (docs/plans/m3.md), so the second message costs
    // one query and nothing else: no POST, and the row it already sent is left
    // exactly as the first attempt wrote it.
    expect(second).toMatchObject({ scanned: 0, delivered: 0, failed: 0, gaveUp: 0 });
    expect(receiver.posted).toHaveLength(1);
    const [after] = (await db.query.delivery.findMany()).filter((row) => row.target === "webhook");
    expect(after).toMatchObject({ attempts: 1, lastStatus: 200 });
    expect(after?.deliveredAt).toEqual(sent?.deliveredAt);
  });
});

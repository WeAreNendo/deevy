import {
  channel as channelTable,
  notificationPreference,
  routingRule,
  type Db,
  type Event,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { routeEvent } from "../src/notifications.ts";
import { slackMessage } from "../src/slack.ts";
import { deliverDueChannelMessages, dueDeliveriesQuery } from "../src/work.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";
import { newId } from "../src/ids.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const webhookUrl = "https://hooks.slack.example/services/T000/B000/xxx";

/**
 * An admin, a second Human to be notified, and a Project bound to a tracker
 * Socket with one record projected from it (ADR-0024).
 *
 * A mention is the Event these tests route: it is the one a Human writes, it
 * reaches as many Humans as the body names, and it is what tells a room full of
 * them that something happened.
 */
async function workspace() {
  const { db, close } = testDb();
  closers.push(close);
  const alice = await memberContext(db, { role: "admin", name: "Alice" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  const { sockets } = fakeSockets();
  const asAlice = createRouterClient(router, { context: { ...alice, sockets } });
  const { project, record } = await seedProject(db, alice.workspace.id);
  const issue = await record({ externalId: "1", title: "Ship the thing" });
  return { db, alice, bob, asAlice, project, issue, sockets, workspaceId: alice.workspace.id };
}

interface SlackChannelOptions {
  workspaceId: string;
  kind?: "mention" | "run_finished" | null;
  projectId?: string | null;
}

/** A Slack Channel and one rule pointing at it. */
async function slackChannel(db: Db, options: SlackChannelOptions) {
  const channelId = newId("channel");
  await db.insert(channelTable).values({
    id: channelId,
    workspaceId: options.workspaceId,
    kind: "slack",
    name: "#deevy",
    config: { webhookUrl },
  });
  await db.insert(routingRule).values({
    id: newId("routingRule"),
    workspaceId: options.workspaceId,
    notificationKind: options.kind === undefined ? null : options.kind,
    projectId: options.projectId ?? null,
    channelId,
  });
  return channelId;
}

/** The Event a write appended, so routing can be asked about it directly. */
async function lastEvent(db: Db, kind: string): Promise<Event> {
  const rows = await db.query.event.findMany({ orderBy: { seq: "desc" }, limit: 50 });
  const found = rows.find((row) => row.kind === kind);
  if (!found) throw new Error(`no ${kind} Event was appended`);
  return found;
}

describe("routing a mention", () => {
  it("reaches the inbox and the Slack Channel a rule points at", async () => {
    const { db, asAlice, issue, workspaceId } = await workspace();
    const channelId = await slackChannel(db, { workspaceId, kind: "mention" });

    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob can you look?" });

    const routing = await routeEvent(db, await lastEvent(db, "comment.created"));
    expect(routing.inbox).toHaveLength(1);
    expect(routing.inbox[0]?.kind).toBe("mention");
    expect(routing.slack).toEqual([{ channelId, target: "slack", kind: "mention" }]);
  });

  it("leaves one delivery owed to the Channel, whatever the Event told Humans", async () => {
    const { db, asAlice, issue, workspaceId } = await workspace();
    const channelId = await slackChannel(db, { workspaceId, kind: "mention" });
    // A third Human, so the comment concerns two of them and the room still
    // hears once: a Slack Channel is a room, not a person.
    await memberContext(db, { name: "Carol", email: "carol@example.com" });

    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob @carol thoughts?" });

    const event = await lastEvent(db, "comment.created");
    expect(await db.query.notification.findMany({ where: { eventId: event.seq } })).toHaveLength(2);
    const owed = await db.query.delivery.findMany();
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({
      workspaceId,
      target: "slack",
      targetId: channelId,
      eventSeq: event.seq,
      recipientMemberId: null,
      attempts: 0,
      deliveredAt: null,
    });
  });

  it("stays in the inbox for a Human who turned Slack off for that kind", async () => {
    const { db, bob, asAlice, issue, workspaceId } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention" });
    await db.insert(notificationPreference).values({
      memberId: bob.member.id,
      kind: "mention",
      slack: false,
    });

    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob can you look?" });

    const routing = await routeEvent(db, await lastEvent(db, "comment.created"));
    expect(routing.inbox).toHaveLength(1);
    expect(routing.slack).toEqual([]);
  });

  it("still reaches the room when only one of the two Humans turned Slack off", async () => {
    const { db, bob, asAlice, issue, workspaceId } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention" });
    await memberContext(db, { name: "Carol", email: "carol@example.com" });
    await db.insert(notificationPreference).values({
      memberId: bob.member.id,
      kind: "mention",
      slack: false,
    });

    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob @carol thoughts?" });

    // A preference says what reaches a person, and a Slack Channel is a room:
    // Bob's says nothing about what Carol may see posted in one. It stops the
    // message only when nobody it concerns wanted it there.
    const routing = await routeEvent(db, await lastEvent(db, "comment.created"));
    expect(routing.inbox).toHaveLength(2);
    expect(routing.slack).toHaveLength(1);
  });
});

describe("the Slack message a Notification becomes", () => {
  it("says what happened and links back to the Issue", () => {
    const message = slackMessage({
      // The key is the tracker's, so it is what a Human recognises (ADR-0024).
      kind: "mention",
      issue: { id: "iss_0123456789ab", key: "acme/deevy#1", title: "Ship the thing" },
      baseUrl: "https://deevy.example",
    });

    expect(message.text).toContain("acme/deevy#1");
    const rendered = JSON.stringify(message);
    // The Work item, where the record is in deevy (ADR-0024).
    expect(rendered).toContain("https://deevy.example/work/iss_0123456789ab|acme/deevy#1");
    expect(rendered).toContain("mentioned");
    expect(message.blocks[0]?.type).toBe("section");
  });
});

interface Posted {
  url: string;
  body: string;
}

/** A Slack that answers however the test says, and remembers what it was sent. */
function stubFetch(reply: () => Response) {
  const posted: Posted[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    posted.push({ url, body: init.body as string });
    return reply();
  };
  return { posted, fetch: fetchImpl };
}

/**
 * Counts the statements a pass issues. Every Drizzle statement starts with one
 * of these calls, so the names recorded are the statements, in order, and
 * `query` records a sweep reaching for the relational API, which would be a
 * read per row (tests/work.test.ts keeps the same watch on the stale sweep).
 */
function countingDb(db: Db) {
  const statements: string[] = [];
  const starters = new Set(["select", "insert", "update", "delete", "run", "all", "get", "batch"]);
  const counted = new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property === "query") statements.push("query");
      if (typeof property !== "string" || !starters.has(property)) return value;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        statements.push(property);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Db;
  return { counted, statements };
}

const ok = () => new Response("ok", { status: 200 });
const refused = () => new Response("invalid_token", { status: 403 });

describe("delivering what is owed to a Slack Channel", () => {
  it("posts the message the Event says, and marks the delivery done", async () => {
    const { db, asAlice, issue, workspaceId } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention" });
    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob can you look?" });
    const slack = stubFetch(ok);

    const result = await deliverDueChannelMessages({
      db,
      workspaceId,
      baseUrl: "https://deevy.example",
      fetch: slack.fetch,
    });

    expect(result).toMatchObject({ scanned: 1, delivered: 1, failed: 0, more: false });
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0]?.url).toBe(webhookUrl);
    expect(slack.posted[0]?.body).toContain("acme/deevy#1");
    expect(slack.posted[0]?.body).toContain(`https://deevy.example/work/${issue.id}`);
    const [row] = await db.query.delivery.findMany();
    expect(row?.deliveredAt).not.toBeNull();
    expect(row).toMatchObject({ attempts: 1, lastStatus: 200 });
  });

  it("tries a refused message again on a growing backoff, and gives up in the end", async () => {
    const { db, asAlice, issue, workspaceId } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention" });
    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob can you look?" });
    const slack = stubFetch(refused);

    // Each pass runs at the moment the row says it is next due, so the backoff
    // is what decides how many attempts happen, not the loop.
    const waits: number[] = [];
    const results = [];
    let now = new Date();
    for (let pass = 0; pass < 8; pass += 1) {
      results.push(
        await deliverDueChannelMessages({
          db,
          workspaceId,
          baseUrl: "https://deevy.example",
          now,
          fetch: slack.fetch,
        }),
      );
      const [row] = await db.query.delivery.findMany();
      const due = row?.nextAttemptAt ?? now;
      if (due > now) waits.push(due.getTime() - now.getTime());
      now = due > now ? due : now;
    }

    // Six attempts, each further off than the last, and then silence.
    expect(slack.posted).toHaveLength(6);
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000]);
    expect(results[5]).toMatchObject({ scanned: 1, delivered: 0, failed: 1, gaveUp: 1 });
    expect(results[6]).toMatchObject({ scanned: 0, delivered: 0, failed: 0, gaveUp: 0 });
    const [row] = await db.query.delivery.findMany();
    expect(row).toMatchObject({
      attempts: 6,
      deliveredAt: null,
      lastStatus: 403,
      lastError: "invalid_token",
    });
  });

  it("is claimed by one sweep only, because two of them must not send it twice", async () => {
    const { db, asAlice, issue, workspaceId } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention" });
    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob the first thing" });
    await asAlice.comments.create({ issue: issue.externalKey, body: "@bob the second thing" });
    const slack = stubFetch(ok);
    const now = new Date();
    const pass = () =>
      deliverDueChannelMessages({
        db,
        workspaceId,
        baseUrl: "https://deevy.example",
        now,
        fetch: slack.fetch,
      });

    const [first, second] = await Promise.all([pass(), pass()]);

    // Two Events are owed and two messages are posted, however the two passes
    // divided them: the claim is what makes that true without a transaction.
    expect(first.scanned + second.scanned).toBe(2);
    expect(first.delivered + second.delivered).toBe(2);
    expect(slack.posted).toHaveLength(2);
  });

  it("is answered by the index it was given, and sorts nothing", async () => {
    const { db, workspaceId } = await workspace();
    const query = dueDeliveriesQuery(db, { workspaceId, now: new Date(), limit: 20 });

    const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`);
    const detail = plan.map((step) => step.detail).join("\n");

    expect(detail).toContain("delivery_due_idx");
    // A sort would visit every due delivery before the LIMIT applied, so one
    // pass would cost the backlog instead of the limit.
    expect(detail).not.toContain("TEMP B-TREE");
    expect(detail).not.toContain("SCAN");
  });

  it("costs the same handful of statements whatever is owed", async () => {
    const { db, asAlice, issue, workspaceId } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention" });
    for (let n = 0; n < 20; n += 1) {
      await asAlice.comments.create({ issue: issue.externalKey, body: `@bob thing ${n}` });
    }
    const slack = stubFetch(ok);
    const { counted, statements } = countingDb(db);

    const result = await deliverDueChannelMessages({
      db: counted,
      workspaceId,
      baseUrl: "https://deevy.example",
      limit: 10,
      fetch: slack.fetch,
    });

    expect(result).toMatchObject({ scanned: 10, delivered: 10, more: true });
    // The due scan, the claim, the three batched lookups the messages are
    // rendered from, and one UPDATE for the ten that landed the same way.
    expect(statements).toEqual(["select", "update", "select", "select", "select", "update"]);
  });
});

describe("a rule scoped to one Project", () => {
  it("does not fire for another Project's Events", async () => {
    const { db, asAlice, workspaceId, project } = await workspace();
    await slackChannel(db, { workspaceId, kind: "mention", projectId: project.id });
    const website = await seedProject(db, workspaceId, {
      slug: "website",
      scopeKey: "acme/website",
    });
    const elsewhere = await website.record({ externalId: "1", title: "Needs a look" });

    await asAlice.comments.create({ issue: elsewhere.url, body: "@bob can you look?" });

    const routing = await routeEvent(db, await lastEvent(db, "comment.created"));
    expect(routing.inbox).toHaveLength(1);
    expect(routing.slack).toEqual([]);
  });
});

describe("routing a finished Run", () => {
  it("reaches Slack only, for a Human who turned their inbox off for that kind", async () => {
    const { db, bob, issue, workspaceId, project } = await workspace();
    const channelId = await slackChannel(db, { workspaceId, kind: "run_finished" });
    await db.insert(notificationPreference).values({
      memberId: bob.member.id,
      kind: "run_finished",
      inbox: false,
    });
    const planner = await agentContext(db, { sponsor: bob.member, grants: [project.id] });
    const asPlanner = createRouterClient(router, { context: planner });
    const run = await asPlanner.runs.start({ issue: issue.externalKey });

    await asPlanner.runs.finish({ runId: run.id, status: "completed", summary: "Done" });

    const routing = await routeEvent(db, await lastEvent(db, "run.completed"));
    expect(routing.inbox).toEqual([]);
    expect(routing.slack).toEqual([{ channelId, target: "slack", kind: "run_finished" }]);
    // The inbox row is not written either: the preference decides the row, not
    // just what a test is told about it.
    const rows = await db.query.notification.findMany({ where: { kind: "run_finished" } });
    expect(rows).toEqual([]);
  });
});

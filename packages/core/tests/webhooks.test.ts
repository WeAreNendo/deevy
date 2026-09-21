import type { Db } from "@deevy/db";
import { agent as agentTable, webhookSubscription } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import { deliverDueWebhooks, deliverWebhook, sweepSchedules } from "../src/work.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";
import { signPayload, verifySignature } from "../src/webhooks.ts";
import { newId } from "../src/ids.ts";

/**
 * A receiver's whole defence is the signature, so it is checked against a
 * value computed outside this codebase rather than against the signer itself:
 *
 *   printf '%s' '1700000000.{"kind":"issue.created","seq":1}' \
 *     | openssl dgst -sha256 -hmac 'whsec_deevy_test_secret' -hex
 *
 * A test that signed the body a second time and compared would pass however
 * wrong the scheme was.
 */
const secret = "whsec_deevy_test_secret";
const body = '{"kind":"issue.created","seq":1}';
const knownGood = "76bd339cb54847044d752956354e3d8d712762042e27b8b4b5617ae5b7a7d29f";

describe("the signature deevy puts on a webhook", () => {
  it("is the HMAC any receiver computes for itself, over the timestamp and the body", async () => {
    const header = await signPayload(secret, new Date(1_700_000_000_000), body);

    expect(header).toBe(`t=1700000000,v1=${knownGood}`);
  });
});

describe("verifying a signature, the way a receiver does", () => {
  /** Assembled from the literal above, never from the signer. */
  const header = `t=1700000000,v1=${knownGood}`;
  const at = new Date(1_700_000_000_000);

  it("accepts the genuine header inside the replay window", async () => {
    expect(await verifySignature({ secret, header, body, now: at })).toBe(true);
    // Four minutes later is still this POST arriving late, not a replay.
    expect(
      await verifySignature({ secret, header, body, now: new Date(at.getTime() + 4 * 60_000) }),
    ).toBe(true);
  });

  it("refuses a changed body, another secret, and a stale timestamp", async () => {
    const tampered = body.replace("issue.created", "issue.deleted");
    expect(await verifySignature({ secret, header, body: tampered, now: at })).toBe(false);
    expect(await verifySignature({ secret: "whsec_other", header, body, now: at })).toBe(false);
    // Six minutes on, the window has closed: a captured POST cannot be replayed.
    expect(
      await verifySignature({ secret, header, body, now: new Date(at.getTime() + 6 * 60_000) }),
    ).toBe(false);
    // And nonsense in the header is a refusal, never a throw.
    expect(await verifySignature({ secret, header: "v1=abc", body, now: at })).toBe(false);
  });
});

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

interface SubscriptionSeed {
  kinds?: string[] | null;
  projectId?: string | null;
  memberId?: string | null;
  url?: string;
  disabledAt?: Date | null;
}

/**
 * An admin, a Project bound to a tracker Socket, and whatever subscriptions a
 * test wants, straight into the table.
 */
async function workspace() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const asAdmin = createRouterClient(router, { context: { ...admin, sockets } });
  const { project } = await seedProject(db, admin.workspace.id);

  async function subscribe(seed: SubscriptionSeed = {}) {
    const id = newId("webhook");
    await db.insert(webhookSubscription).values({
      id,
      workspaceId: admin.workspace.id,
      memberId: seed.memberId ?? null,
      url: seed.url ?? "https://runtime.example/deevy",
      secret,
      kinds: seed.kinds === undefined ? null : seed.kinds,
      projectId: seed.projectId ?? null,
      createdBy: admin.member.id,
      disabledAt: seed.disabledAt ?? null,
    });
    return id;
  }

  return { db, admin, asAdmin, project, workspaceId: admin.workspace.id, subscribe };
}

/** The deliveries owed to a URL, which is the only record that they are owed. */
async function webhookDeliveries(db: Db) {
  const rows = await db.query.delivery.findMany();
  return rows.filter((row) => row.target === "webhook");
}

describe("what an Event owes a subscriber", () => {
  it("inserts exactly one delivery, and never a copy of what it will say", async () => {
    const { db, asAdmin, project, subscribe } = await workspace();
    const subscriptionId = await subscribe({ kinds: ["issue.created"], projectId: project.id });

    await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });

    const owed = await webhookDeliveries(db);
    expect(owed).toHaveLength(1);
    const created = await db.query.event.findFirst({ where: { kind: "issue.created" } });
    expect(owed[0]).toMatchObject({
      target: "webhook",
      targetId: subscriptionId,
      eventSeq: created?.seq,
      attempts: 0,
      deliveredAt: null,
      // A room has recipients; a URL has none.
      recipientMemberId: null,
    });
    // The body is rendered from the Event when it is sent (ADR-0003), so there
    // is nothing here that could disagree with the log.
    expect(Object.keys(owed[0] ?? {})).not.toContain("payload");
    expect(JSON.stringify(owed[0])).not.toContain("Ship the thing");
  });

  it("passes over an Event a subscription did not ask for, and one from another Project", async () => {
    const { db, admin, asAdmin, project, subscribe, workspaceId } = await workspace();
    // What an Agent's runtime usually wants: its own Runs, nothing else.
    await subscribe({ kinds: ["run.*"] });
    const other = await seedProject(db, workspaceId, {
      slug: "website",
      scopeKey: "acme/website",
    });
    await subscribe({ kinds: null, projectId: other.project.id });

    // An `issue.created` in the first Project: the wrong kind for one
    // subscription and the wrong Project for the other.
    const issue = await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });

    expect(await webhookDeliveries(db)).toHaveLength(0);

    // The same subscription hears about a Run, which is the half that proves
    // the filter is a filter and not a wall.
    await appendEvent(
      { db, workspace: admin.workspace, member: admin.member },
      {
        kind: "run.started",
        subjectType: "run",
        subjectId: newId("run"),
        projectId: project.id,
        payload: { issueId: issue.id },
      },
    );
    expect(await webhookDeliveries(db)).toHaveLength(1);
  });

  it("owes nothing to a subscription that has been disabled", async () => {
    const { db, asAdmin, subscribe } = await workspace();
    await subscribe({ disabledAt: new Date() });

    await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });

    expect(await webhookDeliveries(db)).toHaveLength(0);
  });
});

/** A fetch that never leaves the process, and remembers every POST it was given. */
function stubFetch(respond: () => Response) {
  const posted: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  return {
    posted,
    fetch: async (url: string, init: RequestInit) => {
      posted.push({
        url,
        body: init.body as string,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return respond();
    },
  };
}

const ok = () => new Response("", { status: 200 });

interface Started {
  kind: string;
  payload: { trigger: string };
}

describe("delivering what is owed to a URL", () => {
  it("POSTs the Event itself, signed, and marks the delivery done", async () => {
    const { db, asAdmin, subscribe } = await workspace();
    await subscribe({ kinds: ["issue.created"] });
    const issue = await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const [owed] = await webhookDeliveries(db);
    const receiver = stubFetch(ok);
    const now = new Date();

    const result = await deliverWebhook({
      db,
      deliveryId: owed?.id as string,
      now,
      fetch: receiver.fetch,
    });

    expect(result).toMatchObject({ scanned: 1, delivered: 1, failed: 0, gaveUp: 0 });
    const [sent] = receiver.posted;
    expect(sent?.url).toBe("https://runtime.example/deevy");
    // The receiver's own check, against the secret it shares with deevy.
    expect(
      await verifySignature({
        secret,
        header: sent?.headers["deevy-signature"] as string,
        body: sent?.body as string,
        now,
      }),
    ).toBe(true);
    // The body is the Event, rendered now from the log (ADR-0003).
    const created = await db.query.event.findFirst({ where: { kind: "issue.created" } });
    expect(JSON.parse(sent?.body as string)).toMatchObject({
      seq: created?.seq,
      kind: "issue.created",
      subjectType: "issue",
      payload: { key: issue.externalKey, title: "Ship the thing" },
    });
    const [row] = await webhookDeliveries(db);
    expect(row).toMatchObject({ attempts: 1, lastStatus: 200, lastError: null });
    expect(row?.deliveredAt).not.toBeNull();
  });

  it("waits about ten seconds after a refusal, and twice as long after each one after it", async () => {
    const { db, workspaceId, asAdmin, subscribe } = await workspace();
    await subscribe({ kinds: ["issue.created"] });
    await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const receiver = stubFetch(() => new Response("nope", { status: 500 }));

    let now = new Date();
    const first = await deliverDueWebhooks({ db, workspaceId, now, fetch: receiver.fetch });

    expect(first).toMatchObject({ scanned: 1, delivered: 0, failed: 1, gaveUp: 0 });
    const [after] = await webhookDeliveries(db);
    expect(after).toMatchObject({ attempts: 1, deliveredAt: null, lastStatus: 500 });
    expect(after?.lastError).toBe("nope");
    // Ten seconds, give or take the jitter that keeps a recovering receiver
    // from being hit by its whole backlog at once.
    const wait = (after?.nextAttemptAt.getTime() ?? 0) - now.getTime();
    expect(wait).toBeGreaterThanOrEqual(9_000);
    expect(wait).toBeLessThanOrEqual(12_000);

    // Nothing is owed until then: a pass a second later finds nothing.
    expect(await deliverDueWebhooks({ db, workspaceId, now, fetch: receiver.fetch })).toMatchObject(
      { scanned: 0 },
    );

    now = after?.nextAttemptAt as Date;
    await deliverDueWebhooks({ db, workspaceId, now, fetch: receiver.fetch });
    const [second] = await webhookDeliveries(db);
    const secondWait = (second?.nextAttemptAt.getTime() ?? 0) - now.getTime();
    expect(secondWait).toBeGreaterThan(wait);
    expect(secondWait).toBeLessThanOrEqual(24_000);
  });

  it("gives up after the eighth refusal, says so in the log, and never tries again", async () => {
    const { db, workspaceId, asAdmin, subscribe } = await workspace();
    const subscriptionId = await subscribe({ kinds: ["issue.created"] });
    await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const receiver = stubFetch(() => new Response("gone", { status: 410 }));

    // Each pass runs at the moment the row says it is next due, so the backoff
    // decides how many attempts happen, not the loop.
    let now = new Date();
    const results = [];
    for (let pass = 0; pass < 10; pass += 1) {
      results.push(await deliverDueWebhooks({ db, workspaceId, now, fetch: receiver.fetch }));
      const [row] = await webhookDeliveries(db);
      const due = row?.nextAttemptAt ?? now;
      now = due > now ? due : now;
    }

    expect(receiver.posted).toHaveLength(8);
    expect(results[7]).toMatchObject({ scanned: 1, failed: 1, gaveUp: 1 });
    expect(results[8]).toMatchObject({ scanned: 0, failed: 0, gaveUp: 0 });
    const [row] = await webhookDeliveries(db);
    expect(row).toMatchObject({ attempts: 8, deliveredAt: null, lastStatus: 410 });

    const events = await db.query.event.findMany({ where: { kind: "webhook.exhausted" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subjectType: "webhook",
      subjectId: subscriptionId,
      // Nobody did this: giving up is not the act of a Member.
      actorMemberId: null,
      payload: { attempts: 8, status: 410 },
    });
    // And giving up owes the dead URL nothing: an Event about a subscription
    // that stopped answering must not become another delivery to it.
    expect(await webhookDeliveries(db)).toHaveLength(1);
  });
});

describe("subscribing a URL", () => {
  const url = "https://runtime.example/deevy/hook";

  it("is admin work, appears in the list, and says so in an Event", async () => {
    const { db, asAdmin, project } = await workspace();

    const created = await asAdmin.webhooks.create({
      url,
      secret,
      kinds: ["run.*"],
      projectId: project.id,
    });

    expect(created).toMatchObject({ url, kinds: ["run.*"], projectId: project.id });
    const { subscriptions } = await asAdmin.webhooks.list({});
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ id: created.id, url });
    const events = await db.query.event.findMany({ where: { kind: "webhook.subscribed" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectType: "webhook", subjectId: created.id });
  });

  it("never hands the secret back, in a response or in the log", async () => {
    const { db, asAdmin } = await workspace();

    const created = await asAdmin.webhooks.create({ url, secret });
    const { subscriptions } = await asAdmin.webhooks.list({});
    const events = await db.query.event.findMany({ where: { kind: "webhook.subscribed" } });

    // The secret is what makes the signature mean anything: it goes in and
    // never comes out, of any surface. The Event log is read by every Member.
    for (const surface of [created, subscriptions, events]) {
      expect(JSON.stringify(surface)).not.toContain(secret);
    }
    expect(JSON.stringify(events)).not.toContain(url);
    // The row still has it, or nothing could be signed.
    const stored = await db.query.webhookSubscription.findFirst({ where: { id: created.id } });
    expect(stored?.secret).toBe(secret);
  });

  it("belongs to the Sponsor of the Agent it is for, and to no other Human", async () => {
    const { db, asAdmin } = await workspace();
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });
    const asBob = createRouterClient(router, { context: bob });
    const asCarol = createRouterClient(router, { context: carol });
    const planner = await agentContext(db, { sponsor: bob.member, name: "Planner" });

    const mine = await asBob.webhooks.create({ memberId: planner.member.id, url, secret });

    expect((await asBob.webhooks.list({})).subscriptions).toHaveLength(1);
    // Carol sponsors nobody, so there is nothing here for her to see or touch.
    expect((await asCarol.webhooks.list({})).subscriptions).toHaveLength(0);
    await expect(
      asCarol.webhooks.update({ subscriptionId: mine.id, disabled: true }),
    ).rejects.toThrow(/Sponsor/);
    // A subscription belonging to no Agent is the Workspace's own.
    await expect(asBob.webhooks.create({ url, secret })).rejects.toThrow(/admin/);
    // The admin sees every one of them.
    expect((await asAdmin.webhooks.list({})).subscriptions).toHaveLength(1);
  });

  it("is closed to an Agent, because an Agent never administers", async () => {
    const { db, project } = await workspace();
    const planner = await agentContext(db, { grants: [project.id] });
    const asAgent = createRouterClient(router, { context: planner });

    await expect(asAgent.webhooks.list({})).rejects.toThrow(/Agent cannot/);
    await expect(asAgent.webhooks.create({ url, secret })).rejects.toThrow(/Agent cannot/);
  });

  it("switches off without forgetting, and forgets on its own Event", async () => {
    const { db, asAdmin } = await workspace();
    const created = await asAdmin.webhooks.create({ url, secret });

    // Subscribing is itself an Event, so the new subscription is owed it: the
    // first thing a receiver hears is that deevy has it, which is as good a
    // proof that the URL works as a Test button would be.
    expect(await webhookDeliveries(db)).toHaveLength(1);

    const off = await asAdmin.webhooks.update({ subscriptionId: created.id, disabled: true });
    expect(off.disabledAt).not.toBeNull();
    await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    // Switched off, it is owed nothing more, not even the switching off.
    expect(await webhookDeliveries(db)).toHaveLength(1);

    await asAdmin.webhooks.delete({ subscriptionId: created.id });
    expect((await asAdmin.webhooks.list({})).subscriptions).toHaveLength(0);
    // Switching off and deleting are the same news to everyone downstream.
    expect(await db.query.event.findMany({ where: { kind: "webhook.removed" } })).toHaveLength(2);
  });

  it("shows what it was owed lately, and owes a delivery again on request", async () => {
    const { db, workspaceId, asAdmin } = await workspace();
    const created = await asAdmin.webhooks.create({ url, secret, kinds: ["issue.created"] });
    await asAdmin.issues.create({ projectSlug: "deevy", title: "Ship the thing" });
    const receiver = stubFetch(ok);
    await deliverDueWebhooks({ db, workspaceId, fetch: receiver.fetch });

    const { deliveries } = await asAdmin.webhooks.deliveries({ subscriptionId: created.id });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      eventKind: "issue.created",
      attempts: 1,
      lastStatus: 200,
      lastError: null,
    });
    expect(deliveries[0]?.deliveredAt).not.toBeNull();

    await asAdmin.webhooks.redeliver({
      subscriptionId: created.id,
      deliveryId: deliveries[0]?.id as string,
    });

    // Owed again from the beginning, and sent by the sweep rather than here:
    // the row is the record, and a Redeliver that raced a tick still sends once.
    const [row] = await webhookDeliveries(db);
    expect(row).toMatchObject({ attempts: 0, deliveredAt: null });
    await deliverDueWebhooks({ db, workspaceId, fetch: receiver.fetch });
    expect(receiver.posted).toHaveLength(2);
  });
});

describe("what a receiver actually gets", () => {
  /**
   * The other tests here stop at the delivery row or at `deliverDueWebhooks`'
   * return value. That is what let a real bug through: a sweep wrote its Events
   * straight to the log, delivery was derived inside `appendEvent`, and nothing
   * observed that the POST never arrived. This one follows a trigger all the
   * way to the receiver and verifies the signature the way a receiver would.
   */
  it("is a signed POST it can verify, for an Event a sweep wrote", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const { project } = await seedProject(db, ada.workspace.id);
    const agent = await agentContext(db, { sponsor: ada.member, grants: [project.id] });
    const asAgent = createRouterClient(router, { context: agent });

    const secret = "whsec_the_receiver_holds_this_one";
    await asAda.webhooks.create({ url: "https://runner.example/deevy", secret, kinds: ["run.*"] });

    // Routing is what hands a record to an Agent now, and it is stated by
    // opening the record with the Agent's label on it (ADR-0024).
    const issue = await asAda.issues.create({
      projectSlug: "deevy",
      title: "Nightly",
      assignAgent: agent.member.id,
    });
    const opened = await asAgent.runs.list({ issue: issue.externalKey });
    await asAgent.runs.finish({
      runId: opened.runs[0]?.id ?? "",
      status: "completed",
      summary: "done",
    });
    await db
      .update(agentTable)
      .set({ scheduleMinutes: 60 })
      .where(eq(agentTable.memberId, agent.member.id));

    // The schedule sweep writes run.started without going through appendEvent.
    const swept = await sweepSchedules({ db, workspaceId: ada.workspace.id });
    expect(swept.started).toBe(1);

    const receiver = stubFetch(ok);
    await deliverDueWebhooks({
      db,
      workspaceId: ada.workspace.id,
      fetch: receiver.fetch,
    });

    // Both paths arrive: the assignment trigger goes through appendEvent, the
    // schedule does not, and the receiver cannot tell the difference.
    const started = receiver.posted
      .map((post) => ({ post, body: JSON.parse(post.body) as Started }))
      .filter(({ body }) => body.kind === "run.started");
    expect(started.map(({ body }) => body.payload.trigger).sort()).toEqual([
      "assignment",
      "schedule",
    ]);

    const post = started.find(({ body }) => body.payload.trigger === "schedule")?.post;
    expect(post?.url).toBe("https://runner.example/deevy");

    // And the receiver can prove it came from deevy, which is the only reason
    // the delivery is worth anything.
    const verified = await verifySignature({
      secret,
      header: post?.headers["deevy-signature"] ?? "",
      body: post?.body ?? "",
    });
    expect(verified).toBe(true);
  });
});

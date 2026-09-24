import {
  account,
  gateDecision,
  member as memberTable,
  memberIdentity,
  project as projectTable,
  socket as socketTable,
  user,
  type Db,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { applyInbound } from "../src/sockets/apply.ts";
import type { IdentityScope, InboundEvent } from "../src/sockets/port.ts";
import { deliverDueSocketMirrors } from "../src/work.ts";
import { createApp } from "../src/app.ts";
import {
  agentContext,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  testSealingSecret,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** github.com, whose accounts are the ones deevy signs people in with. */
const github: IdentityScope = { instance: "github.com", signInProvider: "github" };

/**
 * A Gate an Agent is waiting at, and three Humans who might rule on it from the
 * tracker (ADR-0025).
 *
 * Ada is the admin and the Agent's Sponsor — so the Human this Run is for — and
 * signed in to deevy with GitHub, which is what a Better Auth `account` row
 * says. Bob signed in with GitHub too. Carol signed in with Google, so deevy
 * knows nothing about her GitHub account until she links it.
 */
async function waiting(
  db: Db,
  checkpoint: { approvalsRequired?: number; excludeRequester?: boolean } = {},
) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });
  for (const [who, id] of [
    [ada, "1001"],
    [bob, "1002"],
  ] as const) {
    await db.insert(account).values({
      id: newId("account"),
      accountId: id,
      providerId: "github",
      userId: who.member.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const seeded = await seedProject(db, ada.workspace.id);
  const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const fake = fakeSockets();
  const asAda = createRouterClient(router, { context: { ...ada, sockets: fake.sockets } });
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets: fake.sockets } });
  await asAda.checkpoints.set({
    projectSlug: seeded.project.slug,
    checkpoints: [
      {
        name: "ship",
        approvalsRequired: checkpoint.approvalsRequired ?? 1,
        excludeRequester: checkpoint.excludeRequester ?? false,
      },
    ],
  });
  const run = await asPlanner.runs.start({ issue: issue.url });
  const gate = await asPlanner.gates.request({
    runId: run.id,
    checkpoint: "ship",
    proposal: "Ship it",
  });
  const socketRow = (await db.query.socket.findFirst({
    where: { id: seeded.socketId },
  })) as NonNullable<Awaited<ReturnType<typeof db.query.socket.findFirst>>>;

  let comments = 0;
  /** One comment in the tracker, by somebody, as a delivery carries it. */
  const say = async (
    author: { login: string; id: string; isBot?: boolean; email?: string },
    body = "/approve",
    scope: IdentityScope = github,
  ) => {
    comments += 1;
    const event: InboundEvent = {
      kind: "ruling",
      scopeKey: "acme/deevy",
      issueExternalId: "42",
      comment: {
        externalId: `c${String(comments)}`,
        url: `https://github.test/acme/deevy/issues/42#c${String(comments)}`,
        body,
        author: { isBot: false, ...author },
        createdAt: new Date(),
      },
      decision: body.startsWith("/reject") ? "rejected" : "approved",
      note: body.replace(/^\/(approve|reject)\s*/, "") || null,
    };
    const socket =
      (await db.query.socket.findFirst({ where: { id: seeded.socketId } })) ?? socketRow;
    return applyInbound({
      db,
      workspace: { id: ada.workspace.id },
      socket,
      events: [event],
      identityScope: scope,
    });
  };

  return {
    ada,
    bob,
    carol,
    seeded,
    issue,
    run,
    gate,
    fake,
    asAda,
    say,
    decisions: () => db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } }),
    kinds: async () =>
      (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map((event) => event.kind),
    /** What deevy said back in the tracker, once the mirror has been sent. */
    replies: async () => {
      await deliverDueSocketMirrors({
        db,
        workspaceId: ada.workspace.id,
        sockets: fake.sockets,
        baseUrl: "https://deevy.test",
      });
      return fake.comments.map((comment) => comment.body);
    },
  };
}

describe("a Ruling from the tracker", () => {
  it("is the Human's, with no linking step, when they signed in to deevy with that account", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { bob, gate, say, decisions, kinds } = await waiting(db);

    const said = await say({ login: "bob", id: "1002" }, "/approve Looks right");

    expect(said.applied).toBe(1);
    expect(await decisions()).toMatchObject([
      {
        memberId: bob.member.id,
        decision: "approved",
        note: "Looks right",
        via: "socket",
        externalRef: { externalId: "c1" },
      },
    ]);
    expect((await db.query.gateRequest.findFirst({ where: { id: gate.id } }))?.status).toBe(
      "approved",
    );
    // What the sign-in vouched for is written down, so the next comment is one
    // indexed read, and so the Human can see it and take it back.
    expect(await db.query.memberIdentity.findMany({})).toMatchObject([
      {
        memberId: bob.member.id,
        provider: "stub",
        instance: "github.com",
        externalUserId: "1002",
        externalLogin: "bob",
        verifiedBy: "sign_in",
        revokedAt: null,
      },
    ]);
    expect(await kinds()).toContain("identity.linked");
  });

  it("tells an account deevy cannot place how to link it, and rules nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { say, decisions, kinds, replies } = await waiting(db);

    await say({ login: "carol-gh", id: "2003" });

    expect(await decisions()).toEqual([]);
    expect(await kinds()).toContain("gate.ruling_refused");
    const reply = (await replies()).find((body) => body.includes("@carol-gh"));
    expect(reply).toContain("https://deevy.test/settings/identities");
    expect(reply).toContain("ruled nothing");
  });

  it("rules once the Human has linked the account, with the same comment", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { carol, say, decisions } = await waiting(db);
    await say({ login: "carol-gh", id: "2003" });
    expect(await decisions()).toEqual([]);

    // What Better Auth's own link-social writes when a signed-in Human proves
    // a second account (Settings › Identities).
    await db.insert(account).values({
      id: newId("account"),
      accountId: "2003",
      providerId: "github",
      userId: carol.member.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await say({ login: "carol-gh", id: "2003" });

    expect(await decisions()).toMatchObject([{ memberId: carol.member.id, via: "socket" }]);
  });

  it("rules nothing for a machine, deevy's own comment included, and says nothing back", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { say, decisions, kinds, replies } = await waiting(db);

    // deevy's own mirrored comment quotes the words `/approve`, and a bot on a
    // Human's account would otherwise be a way to rule with no Human present.
    await say({ login: "renovate[bot]", id: "1002", isBot: true });
    await say({ login: "deevy", id: "bot-1" });

    expect(await decisions()).toEqual([]);
    expect(await kinds()).not.toContain("gate.ruling_refused");
    expect(await replies()).not.toContainEqual(expect.stringContaining("ruled nothing"));
  });

  it("refuses the Human the Run is for at a four-eyes Checkpoint, in the web's own words", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { say, decisions, replies } = await waiting(db, { excludeRequester: true });

    await say({ login: "ada", id: "1001" });

    expect(await decisions()).toEqual([]);
    const said = await replies();
    expect(said).toContainEqual(
      expect.stringContaining(
        "The ship Checkpoint wants somebody other than the Human this Run is for",
      ),
    );
  });

  it("says the arithmetic when one is not enough, and the Run keeps waiting", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { run, say, decisions, replies } = await waiting(db, { approvalsRequired: 2 });

    await say({ login: "bob", id: "1002" });

    expect(await decisions()).toHaveLength(1);
    expect((await db.query.run.findFirst({ where: { id: run.id } }))?.status).toBe(
      "awaiting_input",
    );
    // This Human never sees the ruling screen, so the reply is the card.
    expect(await replies()).toContainEqual(expect.stringContaining("1 of 2"));
  });

  it("refuses an account linked to a suspended Member", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { bob, say, decisions, replies } = await waiting(db);
    await db
      .update(memberTable)
      .set({ suspendedAt: new Date() })
      .where(eq(memberTable.id, bob.member.id));

    await say({ login: "bob", id: "1002" });

    expect(await decisions()).toEqual([]);
    expect(await replies()).toContainEqual(expect.stringContaining("suspended"));
  });

  it("keeps an unlinked account unlinked, whatever the sign-in says", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { say, decisions } = await waiting(db, { approvalsRequired: 2 });
    await say({ login: "bob", id: "1002" });
    expect(await decisions()).toHaveLength(1);
    // Bob unlinks it (Settings › Identities), and his first Ruling is taken
    // back so the second one has something to prove.
    await db.update(memberIdentity).set({ revokedAt: new Date() });
    await db.delete(gateDecision);

    await say({ login: "bob", id: "1002" });

    // Better Auth still holds the account he signs in with, and it would link
    // him again in a heartbeat: a revoked Identity is what says it must not.
    expect(await decisions()).toEqual([]);
  });

  it("matches an address only on a Socket whose admin allowed it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { carol, seeded, say, decisions } = await waiting(db);
    const notion: IdentityScope = { instance: "notion:acme" };
    // Carol signed in with Google, which proved her address: the only kind of
    // address this is ever matched against.
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, carol.member.userId));

    // Off, which is the default: an address the tool reports is not proof.
    await say({ login: "Carol", id: "n-1", email: "carol@example.com" }, "/approve", notion);
    expect(await decisions()).toEqual([]);

    await db
      .update(socketTable)
      .set({ config: { identityByEmail: true } })
      .where(eq(socketTable.id, seeded.socketId));
    await say({ login: "Carol", id: "n-1", email: "carol@example.com" }, "/approve", notion);

    expect(await decisions()).toMatchObject([{ memberId: carol.member.id }]);
    expect(await db.query.memberIdentity.findFirst({})).toMatchObject({ verifiedBy: "email" });
  });

  it("says nothing is waiting where nothing is", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { say, replies } = await waiting(db);
    await say({ login: "bob", id: "1002" });

    await say({ login: "bob", id: "1002" }, "/approve again");

    expect(await replies()).toContainEqual(
      expect.stringContaining("Nothing on this record is waiting on a ruling"),
    );
  });

  it("is refused on a Project that mirrors nothing, and still rules", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { seeded, say, decisions } = await waiting(db);
    await db
      .update(projectTable)
      .set({ mirror: "off" })
      .where(eq(projectTable.id, seeded.project.id));

    // Mirroring is what deevy says back, not what it hears: a Project that
    // asked for silence still takes a Ruling a Human made in the tracker.
    await say({ login: "bob", id: "1002" });

    expect(await decisions()).toHaveLength(1);
  });

  it("rules once for a delivery the tracker sends twice", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const secret = "a-secret-the-tracker-and-deevy-share";
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
    const { sockets } = fakeSockets();
    const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
    const run = await asPlanner.runs.start({ issue: issue.url });
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    const app = createApp({ db, sockets, socketSecret: testSealingSecret });
    const body = JSON.stringify({
      events: [
        {
          kind: "ruling",
          scopeKey: "acme/deevy",
          issueExternalId: "42",
          comment: {
            externalId: "c1",
            url: "https://github.test/acme/deevy/issues/42#c1",
            body: "/reject Not like this",
            author: { login: "bob", id: "1002", isBot: false },
            createdAt: new Date(),
          },
          decision: "rejected",
          note: "Not like this",
        },
      ],
    });
    const send = () =>
      app.request(`/hooks/${seeded.socketId}`, {
        method: "POST",
        headers: {
          "x-test-event": "events",
          // The provider's own id for the delivery, which a redelivery keeps.
          "x-test-delivery": "delivery-1",
          "x-test-signature": `${secret}:${String(body.length)}`,
        },
        body,
      });

    expect(await (await send()).json()).toMatchObject({ status: "applied" });
    expect(await (await send()).json()).toMatchObject({ status: "duplicate" });

    expect(
      await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } }),
    ).toMatchObject([{ memberId: bob.member.id, decision: "rejected", via: "socket" }]);
  });
});

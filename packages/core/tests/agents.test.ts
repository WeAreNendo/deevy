import { createRouterClient, Procedure } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import type { OperationMeta } from "../src/operations/registry.ts";
import { getOperationMeta } from "../src/operations/registry.ts";
import {
  agentContext,
  fakeApiKeys,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
} from "./helpers.ts";

/** Every operation in the router, as the registry describes it. */
function operations(node: unknown, found: OperationMeta[] = []): OperationMeta[] {
  if (node instanceof Procedure) {
    const meta = getOperationMeta(node);
    if (meta) found.push(meta);
    return found;
  }
  if (node && typeof node === "object") {
    for (const child of Object.values(node)) operations(child, found);
  }
  return found;
}

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("the Agent capability rule", () => {
  it("refuses an Agent every operation that does not opt in", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await memberContext(db, { role: "admin", name: "Ada" });
    const agent = await memberContext(db, { kind: "agent", name: "Planner" });
    const asAgent = createRouterClient(router, { context: agent });

    await expect(asAgent.workspace.get({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an Agent call an operation that opts in", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await memberContext(db, { role: "admin", name: "Ada" });
    const agent = await memberContext(db, { kind: "agent", name: "Planner" });
    const asAgent = createRouterClient(router, { context: agent });

    expect(await asAgent.issues.list({})).toMatchObject({ issues: [], nextCursor: null });
  });

  it("opens exactly the operations ADR-0004 allows an Agent", () => {
    const allowed = operations(router)
      .filter((meta) => meta.agents)
      .map((meta) => meta.name)
      .sort();

    expect(allowed).toEqual([
      // Saying something goes to the tracker the Project is bound to; deevy
      // stores no comments and an Agent authors none of the record (ADR-0024).
      "comments.create",
      // Asking to pass a Checkpoint, reading what was ruled, and seeing what
      // it has asked for: an Agent asks and never decides (ADR-0004, ADR-0020).
      // `gates.approve` and `gates.reject` are not here, and could not be:
      // they are `sessionOnly`, so even a Human's own token is refused.
      "gates.get",
      "gates.list",
      "gates.request",
      "inbox.list",
      // Its own inbox, scoped to the caller in the same statement it updates
      // with, so a loop that polls `unreadOnly` can stop finding the same work
      // (docs/plans/m4.md). Not projected as a tool: the loop keeps its books,
      // not the model.
      "inbox.markRead",
      // Opening a record in the tracker, which is how an Agent splits work
      // (docs/plans/sub-issue-delegation.md).
      "issues.create",
      "issues.get",
      "issues.list",
      "links.add",
      "links.list",
      // Bounded to the evidence its own Run attached (docs/plans/m3.md).
      "links.remove",
      // Asking who it is, which is how it learns its own Member id.
      "me.get",
      // Where it learns what its Project is bound to, without asking a Human.
      "projects.get",
      "projects.list",
      // Opening the pull request for its own Run's branch. deevy opens it, so
      // the credential a Run clones with never has to be one that could
      // (ADR-0014, docs/plans/sockets.md slice 6).
      "pulls.open",
      // `runs.answer` is not here: an elicitation asks a Human.
      // `runs.checkout` is, and is deliberately not a tool: it answers with a
      // credential, and a credential in a model's context is one in a
      // transcript.
      "runs.checkout",
      "runs.finish",
      "runs.get",
      "runs.list",
      "runs.postActivity",
      "runs.start",
    ]);
  });
});

describe("Project grants", () => {
  it("hides an ungranted Project from an Agent", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const deevy = await seedProject(db, admin.workspace.id);
    const ops = await seedProject(db, admin.workspace.id, {
      slug: "ops",
      scopeKey: "acme/ops",
    });
    const granted = await deevy.record({ externalId: "1", title: "Granted" });
    const hidden = await ops.record({ externalId: "1", title: "Hidden" });

    const agent = await agentContext(db, { sponsor: admin.member, grants: [deevy.project.id] });
    const asAgent = createRouterClient(router, { context: agent });

    expect((await asAgent.projects.list({})).projects.map((p) => p.slug)).toEqual(["deevy"]);
    expect(await asAgent.issues.get({ issue: granted.externalKey })).toMatchObject({
      externalKey: granted.externalKey,
    });
    // An ungranted Project does not exist to an Agent rather than being
    // forbidden, and the projection inside it is not there either.
    await expect(asAgent.issues.get({ issue: hidden.url })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("agents.create", () => {
  it("makes the Human who creates an Agent its Sponsor", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });

    const created = await asAda.agents.create({ name: "Planner" });

    const row = await db.query.member.findFirst({
      where: { id: created.id },
      with: { user: true, agent: true },
    });
    expect(row).toMatchObject({
      kind: "agent",
      handle: "planner",
      sponsorId: ada.member.id,
      user: { name: "Planner", kind: "agent" },
    });
    expect(row?.agent).toBeTruthy();
  });

  it("gives the new Agent a key, once, and puts the issue in the log", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const keys = fakeApiKeys();
    const asAda = createRouterClient(router, { context: { ...ada, apiKeys: keys } });

    const created = await asAda.agents.create({ name: "Planner" });

    const row = await db.query.member.findFirst({ where: { id: created.id } });
    expect(keys.issued).toMatchObject([{ userId: row?.userId, name: "first key" }]);
    expect(created.key?.key).toBe(keys.issued[0]?.plaintext);

    const events = await db.query.event.findMany({ orderBy: { seq: "asc" } });
    expect(events.map((event) => event.kind)).toEqual(["agent.created", "agent.key_issued"]);

    // Asking again never hands the plaintext back: deevy keeps a hash.
    const listed = await asAda.agents.keys.list({ memberId: created.id });
    expect(JSON.stringify(listed)).not.toContain(created.key?.key);
  });

  it("creates the Agent even where nothing can mint a key", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });

    const created = await asAda.agents.create({ name: "Planner" });

    expect(created.key).toBeNull();
    expect(created.handle).toBe("planner");
  });

  it("suffixes a handle another Member already answers to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    // A Human already answers to `planner`, and a handle is what a mention
    // resolves to, so the two cannot be the same word.
    await memberContext(db, { name: "Planner", email: "planner@example.com" });

    const first = await asAda.agents.create({ name: "Planner" });
    const second = await asAda.agents.create({ name: "Planner" });

    expect([first.handle, second.handle]).toEqual(["planner-2", "planner-3"]);
    const taken = await db.query.member.findMany({ where: { kind: "agent" } });
    expect(new Set(taken.map((row) => row.handle)).size).toBe(2);
  });

  it("appends one agent.created Event with the Agent as its subject", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });

    const created = await asAda.agents.create({ name: "Planner" });

    const events = await db.query.event.findMany({ orderBy: { seq: "asc" } });
    expect(events.filter((row) => row.kind === "agent.created")).toMatchObject([
      {
        actorMemberId: ada.member.id,
        subjectType: "member",
        subjectId: created.id,
        payload: { handle: "planner", name: "Planner" },
      },
    ]);
  });
});

describe("agents.list", () => {
  it("shows every Agent with its Sponsor, its status and its grants", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const { project: dev } = await seedProject(db, ada.workspace.id);
    await asAda.agents.create({ name: "Planner" });
    const second = await agentContext(db, {
      sponsor: ada.member,
      name: "Builder",
      grants: [dev.id],
    });

    const { agents } = await asAda.agents.list({});

    expect(agents.map((row) => row.user.name)).toEqual(["Planner", "Builder"]);
    expect(agents[1]).toMatchObject({
      id: second.member.id,
      sponsor: { id: ada.member.id },
      suspendedAt: null,
      webhookUrl: null,
      grantedProjectIds: [dev.id],
    });
  });
});

describe("agents.update", () => {
  it("lets the Sponsor rename its Agent and set where deevy delivers to it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const created = await asAda.agents.create({ name: "Planner" });

    await asAda.agents.update({
      memberId: created.id,
      name: "Plan Writer",
      handle: "plan-writer",
      webhookUrl: "https://example.test/hook",
      webhookSecret: "whsec_a_secret_the_receiver_holds",
    });

    // Read back through the operation rather than the table: where the URL is
    // stored is this slice's business, and an assertion on the row would break
    // when it moves even though the Sponsor still sees what they set.
    expect((await asAda.agents.list({})).agents[0]).toMatchObject({
      handle: "plan-writer",
      user: { name: "Plan Writer" },
      webhookUrl: "https://example.test/hook",
    });
    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map((e) => e.kind);
    expect(kinds.filter((kind) => kind === "agent.updated")).toEqual(["agent.updated"]);
  });

  it("sets and clears the schedule that wakes an Agent on its assigned Issues", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const created = await asAda.agents.create({ name: "Planner" });

    const hourly = await asAda.agents.update({ memberId: created.id, scheduleMinutes: 60 });
    expect(hourly.scheduleMinutes).toBe(60);

    // Null is no schedule, which is how an Agent is put back to reacting only.
    const never = await asAda.agents.update({ memberId: created.id, scheduleMinutes: null });
    expect(never.scheduleMinutes).toBeNull();
    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map((e) => e.kind);
    expect(kinds.filter((kind) => kind === "agent.updated")).toHaveLength(2);
  });

  it("refuses a Human who neither sponsors the Agent nor administers the Workspace", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob" });
    const created = await createRouterClient(router, { context: ada }).agents.create({
      name: "Planner",
    });

    const asBob = createRouterClient(router, { context: bob });
    await expect(asBob.agents.update({ memberId: created.id, name: "Mine" })).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
        message: "Only an Agent's Sponsor or an admin can do that",
      },
    );
  });
});

describe("agents.setSponsor", () => {
  it("moves accountability to another Human and says so in the Event log", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob" });
    const asAda = createRouterClient(router, { context: ada });
    const created = await asAda.agents.create({ name: "Planner" });

    const moved = await asAda.agents.setSponsor({
      memberId: created.id,
      sponsorMemberId: bob.member.id,
    });

    expect(moved.sponsor).toMatchObject({ id: bob.member.id });
    const events = await db.query.event.findMany({ orderBy: { seq: "asc" } });
    expect(events.filter((row) => row.kind === "agent.sponsor_changed")).toMatchObject([
      { subjectId: created.id, payload: { from: ada.member.id, to: bob.member.id } },
    ]);
  });

  it("refuses an ordinary Member, and refuses an Agent as a Sponsor", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob" });
    const asAda = createRouterClient(router, { context: ada });
    const created = await asAda.agents.create({ name: "Planner" });
    const other = await asAda.agents.create({ name: "Builder" });

    await expect(
      createRouterClient(router, { context: bob }).agents.setSponsor({
        memberId: created.id,
        sponsorMemberId: bob.member.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      asAda.agents.setSponsor({ memberId: created.id, sponsorMemberId: other.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Only a Human can sponsor an Agent" });
  });
});

describe("agents.suspend and agents.reinstate", () => {
  it("lets the Sponsor stop and restart its own Agent", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob" });
    const asBob = createRouterClient(router, { context: bob });
    const created = await asBob.agents.create({ name: "Planner" });

    const suspended = await asBob.agents.suspend({ memberId: created.id });
    expect(suspended.suspendedAt).toBeInstanceOf(Date);
    expect(
      (await db.query.member.findFirst({ where: { id: created.id } }))?.suspendedAt,
    ).toBeInstanceOf(Date);

    const back = await createRouterClient(router, { context: ada }).agents.reinstate({
      memberId: created.id,
    });
    expect(back.suspendedAt).toBeNull();

    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map((e) => e.kind);
    expect(
      kinds.filter((kind) => kind.startsWith("member.susp") || kind === "member.reinstated"),
    ).toEqual(["member.suspended", "member.reinstated"]);
  });
});

describe("the Sponsor cascade", () => {
  it("suspends the Agents a suspended Sponsor answers for, and brings back only those", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob" });
    const asAda = createRouterClient(router, { context: ada });
    const asBob = createRouterClient(router, { context: bob });
    const planner = await asBob.agents.create({ name: "Planner" });
    const builder = await asBob.agents.create({ name: "Builder" });
    await asBob.agents.suspend({ memberId: builder.id });

    await asAda.members.suspend({ memberId: bob.member.id });

    const stopped = await db.query.member.findMany({ where: { kind: "agent" } });
    expect(stopped.every((row) => row.suspendedAt instanceof Date)).toBe(true);
    const cascade = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).filter(
      (row) => row.kind === "member.suspended" && row.subjectId === planner.id,
    );
    expect(cascade).toHaveLength(1);

    await asAda.members.reinstate({ memberId: bob.member.id });

    const after = Object.fromEntries(
      (await db.query.member.findMany({ where: { kind: "agent" } })).map((row) => [
        row.id,
        row.suspendedAt,
      ]),
    );
    expect(after[planner.id]).toBeNull();
    expect(after[builder.id]).toBeInstanceOf(Date);
  });

  it("lifts a cascaded suspension when someone else takes the Agent on", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob" });
    const asAda = createRouterClient(router, { context: ada });
    const planner = await createRouterClient(router, { context: bob }).agents.create({
      name: "Planner",
    });
    await asAda.members.suspend({ memberId: bob.member.id });

    const moved = await asAda.agents.setSponsor({
      memberId: planner.id,
      sponsorMemberId: ada.member.id,
    });

    expect(moved.suspendedAt).toBeNull();
    expect(
      (await db.query.member.findFirst({ where: { id: planner.id } }))?.suspendedAt,
    ).toBeNull();
  });
});

describe("agents.keys", () => {
  it("hands the plaintext key over once, for the Agent's own identity", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const keys = fakeApiKeys();
    const asAda = createRouterClient(router, { context: { ...ada, apiKeys: keys } });
    const planner = await asAda.agents.create({ name: "Planner" });
    const row = await db.query.member.findFirst({ where: { id: planner.id } });

    const issued = await asAda.agents.keys.issue({ memberId: planner.id, name: "laptop" });

    // The first is the one it was created with; this is the Sponsor's second.
    expect(keys.issued).toMatchObject([
      { userId: row?.userId, name: "first key" },
      { userId: row?.userId, name: "laptop" },
    ]);
    expect(issued.key).toBe(keys.issued[1]?.plaintext);

    const listed = await asAda.agents.keys.list({ memberId: planner.id });
    expect(listed.keys).toMatchObject([{ name: "first key" }, { id: issued.id, name: "laptop" }]);
    expect(JSON.stringify(listed)).not.toContain(issued.key);
  });

  it("retires a key, and refuses one the Agent never held", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: { ...ada, apiKeys: fakeApiKeys() } });
    const planner = await asAda.agents.create({ name: "Planner" });
    const issued = await asAda.agents.keys.issue({ memberId: planner.id, name: "laptop" });

    expect(await asAda.agents.keys.revoke({ memberId: planner.id, keyId: issued.id })).toEqual({
      revoked: true,
    });
    // The key it was created with is untouched: only the named one was retired.
    expect((await asAda.agents.keys.list({ memberId: planner.id })).keys).toMatchObject([
      { name: "first key" },
    ]);
    await expect(
      asAda.agents.keys.revoke({ memberId: planner.id, keyId: issued.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map((e) => e.kind);
    // Three: the key it was created with, the Sponsor's own, and the retirement.
    expect(kinds.filter((kind) => kind.startsWith("agent.key"))).toEqual([
      "agent.key_issued",
      "agent.key_issued",
      "agent.key_revoked",
    ]);
  });
});

describe("agents.grants", () => {
  it("opens a Project to an Agent and closes it again", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const { project: dev } = await seedProject(db, ada.workspace.id);
    const planner = await asAda.agents.create({ name: "Planner" });

    await asAda.agents.grants.add({ memberId: planner.id, projectId: dev.id });
    expect(
      await db.query.projectGrant.findFirst({ where: { memberId: planner.id } }),
    ).toMatchObject({ projectId: dev.id, grantedBy: ada.member.id });
    expect((await asAda.agents.grants.list({ memberId: planner.id })).projects).toMatchObject([
      { slug: "deevy" },
    ]);

    await asAda.agents.grants.remove({ memberId: planner.id, projectId: dev.id });
    expect(
      await db.query.projectGrant.findFirst({ where: { memberId: planner.id } }),
    ).toBeUndefined();

    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map((e) => e.kind);
    expect(kinds.filter((kind) => kind.startsWith("agent.project"))).toEqual([
      "agent.project_granted",
      "agent.project_revoked",
    ]);
  });
});

describe("an Agent's own webhook", () => {
  it("is the subscription deevy actually delivers to, not a field that goes nowhere", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAdmin = createRouterClient(router, { context: { ...admin, sockets } });
    // The Project has to exist for the Agent to be granted one; nothing here
    // needs its id.
    await seedProject(db, admin.workspace.id);
    const created = await asAdmin.agents.create({ name: "Planner" });

    await asAdmin.agents.update({
      memberId: created.id,
      webhookUrl: "https://runner.example/deevy",
      webhookSecret: "whsec_a_secret_the_receiver_holds",
    });

    // Reading it back is the easy half; the half that was broken is whether
    // anything is owed to that URL once something happens.
    expect((await asAdmin.agents.list({})).agents[0]?.webhookUrl).toBe(
      "https://runner.example/deevy",
    );
    await asAdmin.issues.create({ projectSlug: "deevy", title: "Something to hear about" });

    const owed = await db.query.delivery.findMany({ where: { target: "webhook" } });
    expect(owed.length).toBeGreaterThan(0);
  });
});

describe("setting an Agent's webhook", () => {
  it("refuses a cleartext URL, which would put signed Events on the wire", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const created = await asAda.agents.create({ name: "Planner" });

    await expect(
      asAda.agents.update({
        memberId: created.id,
        webhookUrl: "http://runner.example/deevy",
        webhookSecret: "whsec_test_secret_value",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("takes the secret from the Sponsor, because a generated one nobody can read signs nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const created = await asAda.agents.create({ name: "Planner" });

    // No secret and no subscription yet: deevy cannot invent one, because the
    // API returns no secret by construction and the receiver would have
    // nothing to verify against.
    await expect(
      asAda.agents.update({ memberId: created.id, webhookUrl: "https://runner.example/deevy" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await asAda.agents.update({
      memberId: created.id,
      webhookUrl: "https://runner.example/deevy",
      webhookSecret: "whsec_the_sponsor_knows_this",
    });
    expect((await asAda.agents.list({})).agents[0]?.webhookUrl).toBe(
      "https://runner.example/deevy",
    );
    // Changing only the URL later is fine: the secret it already has stands.
    await asAda.agents.update({ memberId: created.id, webhookUrl: "https://runner.example/v2" });
    expect((await asAda.agents.list({})).agents[0]?.webhookUrl).toBe("https://runner.example/v2");
  });
});

describe("the session rung", () => {
  it("is not a way past the Agent rule or sessionOnly", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const agent = await agentContext(db, { sponsor: ada.member });
    const asAgent = createRouterClient(router, { context: agent });

    // `session` is a lower rung than `member`, not a side door: an operation
    // nobody marked for Agents must refuse one however little authority it asks
    // for. oauthClients.* manages a Human's own MCP client consents.
    await expect(asAgent.oauthClients.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });

    // And a delegated credential held by a Human is refused too, which is what
    // sessionOnly means and what the session rung was returning before.
    const viaToken = createRouterClient(router, {
      context: { ...ada, principal: { kind: "oauth", clientId: "c", scopes: [] } },
    });
    await expect(viaToken.oauthClients.revoke({ clientId: "c" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("every door into an ungranted Project", () => {
  it("is shut, not just the ones that happen to call requireProject", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const { project: dev } = await seedProject(db, ada.workspace.id);
    await seedProject(db, ada.workspace.id, { slug: "ops", scopeKey: "acme/ops" });

    const agent = await agentContext(db, { sponsor: ada.member, grants: [dev.id] });
    const asAgent = createRouterClient(router, { context: agent });

    // Reading a Project it was never granted tells it the Project's name, its
    // description and everything that Project is bound to.
    await expect(asAgent.projects.get({ slug: "ops" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // And the inbox is a door too: a Notification names an Issue, and reading
    // it back is reading a projection in a Project the Agent cannot see.
    await asAda.issues.create({
      projectSlug: "ops",
      title: "Rotate the keys",
      assignAgent: agent.member.id,
    });
    expect((await asAgent.inbox.list({})).notifications).toEqual([]);
  });
});

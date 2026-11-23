import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, router, runDueWork, sealSecret } from "@deevy/core";
import {
  agent as agentTable,
  member as memberTable,
  project as projectTable,
  projectGrant,
  socket as socketTable,
  user as userTable,
  workspace as workspaceTable,
  type Db,
  type Member,
  type Workspace,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createGitlabSocket, socketModules } from "../src/index.ts";
import labeled from "./fixtures/gitlab/issue.labeled.json" with { type: "json" };
import noted from "./fixtures/gitlab/note.approve.json" with { type: "json" };

/**
 * GitLab, through the door deevy actually serves (ADR-0024, ADR-0036).
 *
 * The module is proved against recorded payloads and a fake REST API in the
 * other `gitlab-*` tests. This puts the real module behind the real route with
 * a real database and replaces only GitLab's API — so what is under test is the
 * whole sentence: somebody labels an issue on GitLab, the Agent it names has a
 * Run, its Proposal is a comment on the issue that says where to rule on it, a
 * reply there is only a reply, and a Human who rules in deevy has the issue
 * told.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const secretToken = "deevy-minted-secret-token-for-gitlab";
const TOKEN = "glpat-deevy-bot-token-never-in-a-read";
const DEEVY_BOT = { id: 7001, username: "deevy-bot" };
const ISSUE_URL = labeled.object_attributes.url;

/** GitLab's REST API, as far as deevy can tell: every call written down. */
function gitlabApi() {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let notes = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    const path = url.replace("https://gitlab.com/api/v4", "");
    const body = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as Record<
      string,
      unknown
    >;
    calls.push({ method, path, body });
    if (method === "POST" && path === "/projects/4211/issues/42/notes") {
      return Response.json({ id: 1990442800 + ++notes, body: body.body }, { status: 201 });
    }
    return Response.json({ message: "404 Not found" }, { status: 404 });
  };
  return { calls, fetch };
}

function contextFor(db: Db, member: Member, workspace: Workspace, extra: object = {}) {
  return {
    db,
    member,
    workspace,
    baseURL: "https://deevy.test",
    session: {
      session: { id: newId("session"), userId: member.userId, token: "t", expiresAt: new Date() },
      user: { id: member.userId, name: "Test", email: "test@example.com", image: null },
    },
    ...extra,
  } as never;
}

async function human(db: Db, workspaceId: string, name: string, role: Member["role"] = "member") {
  const userId = newId("user");
  await db
    .insert(userTable)
    .values({ id: userId, name, email: `${name.toLowerCase()}@example.com` });
  const id = newId("member");
  await db
    .insert(memberTable)
    .values({ id, workspaceId, userId, handle: name.toLowerCase(), role, kind: "human" });
  return (await db.query.member.findFirst({ where: { id } })) as Member;
}

/**
 * A Workspace with a GitLab Socket and a Project bound to `acme/deevy` for its
 * issues and its code, written straight into the tables. Ada is the admin and
 * the Planner's Sponsor; Grace is a Member, and on GitLab the author of the
 * recorded note, which deevy takes for nothing more than who wrote it.
 */
async function workspaceOnGitlab(db: Db) {
  const workspaceId = newId("workspace");
  await db.insert(workspaceTable).values({ id: workspaceId, name: "Acme", slug: "acme" });
  const workspace = (await db.query.workspace.findFirst({
    where: { id: workspaceId },
  })) as Workspace;
  const ada = await human(db, workspaceId, "Ada", "admin");
  const grace = await human(db, workspaceId, "Grace");

  const agentUserId = newId("user");
  await db
    .insert(userTable)
    .values({ id: agentUserId, name: "Planner", email: "planner@agents.invalid", kind: "agent" });
  const plannerId = newId("member");
  await db.insert(memberTable).values({
    id: plannerId,
    workspaceId,
    userId: agentUserId,
    handle: "planner",
    role: "member",
    kind: "agent",
    sponsorId: ada.id,
  });
  await db.insert(agentTable).values({ memberId: plannerId });
  const planner = (await db.query.member.findFirst({ where: { id: plannerId } })) as Member;

  const socketId = newId("socket");
  await db.insert(socketTable).values({
    id: socketId,
    workspaceId,
    provider: "gitlab",
    capabilities: ["tracker"],
    name: "Acme on GitLab",
    identity: {
      login: DEEVY_BOT.username,
      id: String(DEEVY_BOT.id),
      mentionHandle: `@${DEEVY_BOT.username}`,
    },
    config: {},
    credentials: await sealSecret(sealing, JSON.stringify({ token: TOKEN })),
    webhookSecret: await sealSecret(sealing, secretToken),
    installedBy: ada.id,
  });
  const projectId = newId("project");
  const scope = { scopeKey: "4211", path: "acme/deevy" };
  await db.insert(projectTable).values({
    id: projectId,
    workspaceId,
    slug: "acme-deevy",
    name: "deevy",
    trackerSocketId: socketId,
    trackerScope: scope,
    trackerScopeKey: "gitlab:4211",
  });
  await db.insert(projectGrant).values({ memberId: plannerId, projectId });

  const api = gitlabApi();
  const sockets = {
    ...socketModules(),
    gitlab: (input: Parameters<typeof createGitlabSocket>[0]) =>
      createGitlabSocket({ ...input, fetch: api.fetch }),
  };
  const app = createApp({ db, sockets, socketSecret: sealing, baseURL: "https://deevy.test" });
  const extra = { sockets, socketSecret: sealing };
  const asPlanner = createRouterClient(router, {
    context: contextFor(db, planner, workspace, { ...extra, grantedProjectIds: [projectId] }),
  });
  const asAda = createRouterClient(router, { context: contextFor(db, ada, workspace, extra) });
  const asGrace = createRouterClient(router, { context: contextFor(db, grace, workspace, extra) });
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return { app, api, socketId, grace, planner, asPlanner, asAda, asGrace, sweep };
}

let deliveries = 0;

/** One delivery, as GitLab sends one with a secret token: the token itself, and a retry key. */
function delivery(event: string, payload: object, token = secretToken) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-event": event,
      "x-gitlab-token": token,
      "idempotency-key": `delivery-${String(++deliveries)}`,
    },
    body: JSON.stringify(payload),
  };
}

/** Grace's comment, or whoever the test says wrote it. */
function comment(body: string, user: { id: number; username: string } = noted.user) {
  return {
    ...noted,
    user: { ...noted.user, ...user },
    object_attributes: {
      ...noted.object_attributes,
      id: 1990442700 + deliveries,
      author_id: user.id,
      note: body,
    },
  };
}

async function opened(db: Db) {
  const walk = await workspaceOnGitlab(db);
  await walk.app.request(`/hooks/${walk.socketId}`, delivery("Issue Hook", labeled));
  const run = await db.query.run.findFirst({ where: { agentMemberId: walk.planner.id } });
  if (!run) throw new Error("the label opened no Run");
  return { ...walk, run };
}

/** What deevy has written on the issue, oldest first. */
function notesOn(api: ReturnType<typeof gitlabApi>) {
  return api.calls
    .filter((call) => call.path.endsWith("/notes"))
    .map((call) => String(call.body.body));
}

describe("somebody labels an issue on GitLab", () => {
  it("and the Agent it names has a Run, whose Gate is said on the issue with where to rule on it", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { api, planner, asPlanner, sweep, run } = await opened(db);

    const issue = await db.query.issue.findFirst({ where: { externalKey: "acme/deevy#42" } });
    expect(issue).toMatchObject({ url: ISSUE_URL, state: "open", assigneeMemberId: planner.id });
    expect(run).toMatchObject({ status: "pending", trigger: "assignment" });

    // The Proposal becomes the bot's comment on the issue, and that comment is
    // all deevy writes there: the issue itself is left as it was.
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "## What I will do\n\nCap the coupon at the basket total.",
    });
    await sweep();

    const [said, ...more] = notesOn(api);
    expect(more).toEqual([]);
    expect(said).toContain("Cap the coupon");
    expect(said).toContain(`Rule on it in deevy: https://deevy.test/gates/${gate.id}`);
    expect(said).not.toContain("/approve");
    expect(api.calls.filter((call) => !call.path.endsWith("/notes"))).toEqual([]);
  });

  it("and a reply of /approve is a comment, so the Gate waits for a Human in deevy, whose Ruling the issue is told", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, socketId, grace, asPlanner, asGrace, sweep, run } = await opened(db);
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap the coupon at the basket total.",
    });
    await sweep();
    const before = Math.max(0, ...(await db.query.event.findMany({})).map((one) => one.seq));

    // Grace's own account on GitLab, and still only something she said.
    const replied = await app.request(
      `/hooks/${socketId}`,
      delivery("Note Hook", comment("/approve cap it at the basket total")),
    );
    expect(await replied.json()).toMatchObject({ status: "applied", applied: 1 });
    await sweep();

    expect(await asGrace.gates.get({ requestId: gate.id })).toMatchObject({ status: "open" });
    expect(await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } })).toEqual([]);
    const since = await db.query.event.findMany({ where: { seq: { gt: before } } });
    expect(since.map((one) => one.kind)).toEqual(["comment.created"]);
    expect(since[0]?.payload).toMatchObject({
      body: "/approve cap it at the basket total",
      externalActor: "grace",
    });
    // And nothing answers it on the issue.
    expect(notesOn(api)).toHaveLength(1);

    // The Ruling is Grace's in deevy, and the issue hears of it as one more comment.
    await asGrace.gates.approve({ requestId: gate.id, note: "Cap it at the basket total." });
    await sweep();

    expect(
      await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } }),
    ).toMatchObject([
      { memberId: grace.id, decision: "approved", note: "Cap it at the basket total." },
    ]);
    expect(notesOn(api)).toEqual([
      expect.stringContaining("Cap the coupon"),
      expect.stringMatching(
        /^\*\*Approved\*\* at the `plan` Checkpoint[^]*> Cap it at the basket total\./,
      ),
    ]);
    expect(api.calls.filter((call) => !call.path.endsWith("/notes"))).toEqual([]);
  });

  it("and deevy's own comment coming back is no comment anybody made, whatever it quotes", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, socketId, asPlanner, run } = await opened(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    const echoed = await app.request(
      `/hooks/${socketId}`,
      delivery("Note Hook", comment("/approve", DEEVY_BOT)),
    );

    expect(await echoed.json()).toMatchObject({
      status: "skipped",
      skipped: ["Acme on GitLab wrote this comment itself"],
    });
    expect(await db.query.gateDecision.findMany({})).toEqual([]);
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).not.toContain("comment.created");
  });

  it("refuses a delivery with somebody else's token, and writes nothing down", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, socketId } = await workspaceOnGitlab(db);

    const forged = await app.request(
      `/hooks/${socketId}`,
      delivery("Issue Hook", labeled, "a-token-somebody-guessed"),
    );

    expect(forged.status).toBe(401);
    expect(await db.query.issue.findFirst({})).toBeUndefined();
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
  });
});

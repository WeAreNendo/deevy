import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, router, runDueWork, sealSecret } from "@deevy/core";
import {
  account as accountTable,
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
 * GitLab, through the door deevy actually serves (ADR-0024, ADR-0025).
 *
 * The module is proved against recorded payloads and a fake REST API in the
 * other `gitlab-*` tests. This puts the real module behind the real route with
 * a real database and replaces only GitLab's API — so what is under test is the
 * whole sentence: somebody labels an issue on GitLab, the Agent it names has a
 * Run, its Proposal is a comment on the issue, a Human who signs in to deevy
 * with GitLab approves it by commenting with no linking step, and the Run
 * clones with the Socket's token and opens a merge request that closes the
 * issue. The forge half is slice 6's, run against GitLab.
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
    if (method === "PUT" && path === "/projects/4211/issues/42") return Response.json({});
    if (method === "GET" && path === "/projects/4211") {
      return Response.json({ id: 4211, http_url_to_repo: "https://gitlab.com/acme/deevy.git" });
    }
    if (method === "POST" && path === "/projects/4211/merge_requests") {
      return Response.json(
        { iid: 7, web_url: "https://gitlab.com/acme/deevy/-/merge_requests/7" },
        { status: 201 },
      );
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
 * the Planner's Sponsor; Grace signs in to deevy with GitLab, which is what
 * Better Auth's `account` row records.
 */
async function workspaceOnGitlab(db: Db) {
  const workspaceId = newId("workspace");
  await db.insert(workspaceTable).values({ id: workspaceId, name: "Acme", slug: "acme" });
  const workspace = (await db.query.workspace.findFirst({
    where: { id: workspaceId },
  })) as Workspace;
  const ada = await human(db, workspaceId, "Ada", "admin");
  const grace = await human(db, workspaceId, "Grace");
  await db.insert(accountTable).values({
    id: newId("account"),
    accountId: String(noted.user.id),
    providerId: "gitlab",
    userId: grace.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

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
    capabilities: ["tracker", "forge"],
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
    forgeSocketId: socketId,
    forgeScope: { ...scope, baseBranch: "main" },
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
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return { app, api, socketId, grace, planner, asPlanner, asAda, sweep };
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

describe("somebody labels an issue on GitLab", () => {
  it("and the Agent it names has a Run, whose Gate is said on the issue and ruled from it", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, socketId, grace, planner, asPlanner, sweep, run } = await opened(db);

    const issue = await db.query.issue.findFirst({ where: { externalKey: "acme/deevy#42" } });
    expect(issue).toMatchObject({ url: ISSUE_URL, state: "open", assigneeMemberId: planner.id });
    expect(run).toMatchObject({ status: "pending", trigger: "assignment" });

    // The Proposal becomes the bot's comment on the issue, with the label that
    // says it waits — which GitLab makes on the project as it adds it.
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "## What I will do\n\nCap the coupon at the basket total.",
    });
    await sweep();
    expect(api.calls.find((call) => call.path.endsWith("/notes"))?.body.body).toContain(
      "Cap the coupon",
    );
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({
      add_labels: "deevy:awaiting-approval",
    });

    // Grace signs in to deevy with GitLab, so her comment is hers with no
    // linking step: GitLab's account id is what Better Auth recorded.
    const ruled = await app.request(
      `/hooks/${socketId}`,
      delivery("Note Hook", comment("/approve cap it at the basket total")),
    );
    expect(await ruled.json()).toMatchObject({ status: "applied" });
    const [decision] = await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } });
    expect(decision).toMatchObject({
      memberId: grace.id,
      decision: "approved",
      via: "socket",
      socketId,
      note: "cap it at the basket total",
    });
    expect(await db.query.memberIdentity.findFirst({})).toMatchObject({
      memberId: grace.id,
      provider: "gitlab",
      instance: "gitlab.com",
      externalUserId: "2931",
      verifiedBy: "sign_in",
    });

    await sweep();
    expect(
      api.calls.filter((call) => call.method === "PUT").map((call) => call.body),
    ).toContainEqual({ remove_labels: "deevy:awaiting-approval" });
  });

  it("but a comment from an account nobody can place rules nothing, and is told where to link it", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, socketId, asPlanner, sweep, run } = await opened(db);
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap the coupon.",
    });

    await app.request(
      `/hooks/${socketId}`,
      delivery("Note Hook", comment("/approve", { id: 9999, username: "a-stranger" })),
    );
    await sweep();

    expect(await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } })).toEqual([]);
    const reply = api.calls
      .filter((call) => call.path.endsWith("/notes"))
      .map((call) => String(call.body.body))
      .find((body) => body.includes("ruled nothing"));
    expect(reply).toContain("https://deevy.test/settings/identities");
  });

  it("and deevy's own comment coming back rules nothing, whatever it quotes", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, socketId, asPlanner, run } = await opened(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    await app.request(`/hooks/${socketId}`, delivery("Note Hook", comment("/approve", DEEVY_BOT)));

    expect(await db.query.gateDecision.findMany({})).toEqual([]);
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).not.toContain("gate.ruling_refused");
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

/**
 * Slice 6's forge half, against GitLab: what a Run clones with, and the merge
 * request deevy opens for it (ADR-0014, ADR-0019).
 */
describe("the code half of a Run on GitLab", () => {
  it("clones with the Socket's token as oauth2, which reaches no Event and no read", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { asPlanner, asAda, run } = await opened(db);

    const checkout = await asPlanner.runs.checkout({ runId: run.id });

    expect(checkout).toMatchObject({
      cloneUrl: "https://gitlab.com/acme/deevy.git",
      username: "oauth2",
      token: TOKEN,
      baseBranch: "main",
    });
    expect(checkout?.headBranch).toMatch(/^deevy\/acme-deevy-42-/);
    const events = await db.query.event.findMany({});
    expect(events.map((event) => event.kind)).toContain("run.checkout_issued");
    const reads = JSON.stringify([
      events,
      await asAda.runs.get({ runId: run.id }),
      await asAda.events.list({}),
    ]);
    expect(reads).not.toContain(TOKEN);
  });

  it("opens one merge request that closes the issue and names the Run, as evidence on the record", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { api, asPlanner, run } = await opened(db);

    const first = await asPlanner.pulls.open({
      runId: run.id,
      head: "deevy/acme-deevy-42-abcd1234",
      summary: "Cap the coupon at the basket total",
    });
    const again = await asPlanner.pulls.open({
      runId: run.id,
      head: "deevy/acme-deevy-42-abcd1234",
    });

    expect(first).toMatchObject({
      url: "https://gitlab.com/acme/deevy/-/merge_requests/7",
      number: 7,
    });
    // Asked twice, it is the one that exists: its number read back out of
    // GitLab's own name for it.
    expect(again).toMatchObject({ url: first.url, number: 7 });
    const asked = api.calls.filter((call) => call.path === "/projects/4211/merge_requests");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.body).toMatchObject({
      source_branch: "deevy/acme-deevy-42-abcd1234",
      target_branch: "main",
      title: "acme/deevy#42: Cap the coupon at the basket total",
      remove_source_branch: true,
    });
    // GitLab closes an issue named by its full URL when the merge request is
    // merged, as GitHub does.
    expect(String(asked[0]?.body.description)).toContain(`Closes ${ISSUE_URL}`);
    expect(String(asked[0]?.body.description)).toContain(run.id);

    const [link] = await db.query.issueLink.findMany({});
    expect(link).toMatchObject({
      kind: "pull_request",
      runId: run.id,
      url: first.url,
      title: "Merge request !7",
    });
    const linked = (await db.query.event.findMany({})).find(
      (event) => event.kind === "issue.link_added",
    );
    expect(linked?.payload).toMatchObject({ runId: run.id });
  });
});

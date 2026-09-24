import { openDatabase } from "@deevy/adapters/node";
import { createApp, finishAccountLink, newId, router, runDueWork, sealSecret } from "@deevy/core";
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
import { createLinearSocket, resetLinearTokens, socketModules } from "../src/index.ts";
import created from "./fixtures/linear/Issue.create.json" with { type: "json" };
import commented from "./fixtures/linear/Comment.create.json" with { type: "json" };

/**
 * Linear, through the door deevy actually serves (ADR-0024, ADR-0025).
 *
 * The module is proved against recorded payloads and a fake API in the other
 * `linear-*` tests. This puts the real module behind the real route with a
 * real database and replaces only Linear's API — so what is under test is the
 * whole sentence: somebody labels an issue in Linear, the Agent it names has a
 * Run, the Agent's Proposal appears on the issue as the app's comment, and a
 * Human who linked their Linear account approves it by commenting `/approve`.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  resetLinearTokens();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const instanceSecret = "an-instance-secret-of-at-least-32-chars";
const webhookSecret = "lin_wh_the_app_and_deevy_share_this";
const ORG = created.organizationId;
const TEAM = created.data.teamId;
const APP_USER = "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9";
const GRACE = commented.data.userId;

/** Linear's API, as far as deevy can tell: every GraphQL call written down by name. */
function linearApi() {
  const calls: Array<{ operation: string; variables: Record<string, unknown> }> = [];
  let comments = 0;
  // Labels Linear knows, so one made on first use is found the next time.
  const labels: Array<{ id: string; name: string; team: { id: string } }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : "";
    if (url.endsWith("/oauth/token")) {
      const form = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ operation: `token:${form.grant_type ?? ""}`, variables: form });
      return Response.json({
        access_token:
          form.grant_type === "client_credentials" ? "lin_app_token" : `lin_user_${form.code}`,
        token_type: "Bearer",
        expires_in: 86_399,
      });
    }
    if (url.endsWith("/oauth/revoke")) return new Response(null, { status: 200 });

    const { query, variables = {} } = JSON.parse(raw) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
    calls.push({ operation, variables });
    const asGrace = headers.get("authorization") === "Bearer lin_user_grace-consented";
    const data: Record<string, unknown> = {
      DeevyWho: {
        viewer: asGrace
          ? { id: GRACE, name: "Grace Hopper", displayName: "grace" }
          : { id: APP_USER, name: "deevy", displayName: "deevy" },
        organization: { id: ORG, name: "Acme", urlKey: "acme" },
      },
      DeevyLabels: { issueLabels: { nodes: labels } },
      DeevyLabelsChange: { issueUpdate: { success: true } },
      DeevyCommentCreate: {
        commentCreate: {
          success: true,
          comment: {
            id: `c${String(++comments)}`,
            url: `${created.url}#comment-c${String(comments)}`,
          },
        },
      },
    };
    if (operation === "DeevyLabelCreate") {
      const made = { id: `label-${String(labels.length + 1)}`, name: "", team: { id: TEAM } };
      made.name = String((variables.input as { name: string }).name);
      labels.push(made);
      data.DeevyLabelCreate = { issueLabelCreate: { success: true, issueLabel: { id: made.id } } };
    }
    return operation in data
      ? Response.json({ data: data[operation] })
      : Response.json({ errors: [{ message: `No answer for ${operation}` }] }, { status: 400 });
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
 * A Workspace with a Linear Socket and a Project bound to the ENG team,
 * written straight into the tables: what `sockets.connect` and
 * `projects.create` would have left. Ada is the admin and the Planner's
 * Sponsor; Grace is the Human who will link her Linear account and rule.
 */
async function workspaceOnLinear(db: Db) {
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
    provider: "linear",
    capabilities: ["tracker"],
    name: "Acme on Linear",
    identity: { login: "deevy", id: APP_USER, mentionHandle: "@deevy" },
    config: { organizationId: ORG, organizationName: "Acme", urlKey: "acme" },
    credentials: await sealSecret(
      sealing,
      JSON.stringify({ clientId: "lin_client_id_1", clientSecret: "lin_client_secret_1" }),
    ),
    webhookSecret: await sealSecret(sealing, webhookSecret),
    installedBy: ada.id,
  });
  const projectId = newId("project");
  await db.insert(projectTable).values({
    id: projectId,
    workspaceId,
    slug: "acme-eng",
    name: "Engineering",
    trackerSocketId: socketId,
    trackerScope: { scopeKey: TEAM, teamKey: "ENG" },
    trackerScopeKey: `linear:${TEAM}`,
  });
  await db.insert(projectGrant).values({ memberId: plannerId, projectId });

  const api = linearApi();
  const sockets = {
    ...socketModules(),
    linear: (input: Parameters<typeof createLinearSocket>[0]) =>
      createLinearSocket({ ...input, fetch: api.fetch }),
  };
  const app = createApp({ db, sockets, socketSecret: sealing, baseURL: "https://deevy.test" });
  const extra = { sockets, socketSecret: sealing, secret: instanceSecret };
  const asPlanner = createRouterClient(router, {
    context: contextFor(db, planner, workspace, { ...extra, grantedProjectIds: [projectId] }),
  });
  const asGrace = createRouterClient(router, { context: contextFor(db, grace, workspace, extra) });
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return {
    db,
    app,
    api,
    socketId,
    workspace,
    ada,
    grace,
    planner,
    asPlanner,
    asGrace,
    sweep,
    graceContext: contextFor(db, grace, workspace, extra) as Parameters<
      typeof finishAccountLink
    >[0],
  };
}

/** One delivery, stamped now and signed the way Linear signs: hex HMAC over the raw body. */
async function delivery(event: string, payload: object, id: string) {
  const body = JSON.stringify({ ...payload, webhookTimestamp: Date.now() });
  return {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "linear-event": event,
      "linear-delivery": id,
      "linear-signature": await sign(body),
    },
    body,
  };
}

let said = 0;

/** Grace's comment, said by whoever the test says said it. */
function comment(body: string, userId = GRACE, name = "Grace Hopper") {
  return {
    ...commented,
    actor: { ...commented.actor, id: userId, name },
    data: {
      ...commented.data,
      id: `comment-${String(++said)}`,
      body,
      userId,
      user: { ...commented.data.user, id: userId, name },
    },
  };
}

describe("somebody labels an issue in Linear", () => {
  it("and the Agent it names has a Run, whose Gate is said on the issue and ruled from it", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, socketId, planner, grace, asPlanner, asGrace, sweep, graceContext } =
      await workspaceOnLinear(db);

    // The label routes it.
    const opened = await app.request(`/hooks/${socketId}`, await delivery("Issue", created, "d-1"));
    expect(await opened.json()).toMatchObject({ status: "applied", applied: 1 });
    const issue = await db.query.issue.findFirst({ where: { externalKey: "ENG-12" } });
    expect(issue).toMatchObject({ state: "open", stateName: "Todo", assigneeMemberId: planner.id });
    const run = await db.query.run.findFirst({ where: { agentMemberId: planner.id } });
    expect(run).toMatchObject({ status: "pending", trigger: "assignment" });

    // The Agent asks, and the Proposal becomes the app's comment on the issue,
    // with the label that says it waits — made on first use.
    const gate = await asPlanner.gates.request({
      runId: run?.id ?? "",
      checkpoint: "plan",
      proposal: "## What I will do\n\nCap the coupon at the basket total.",
    });
    await sweep();
    const said = api.calls.find((call) => call.operation === "DeevyCommentCreate");
    expect(said?.variables).toMatchObject({
      input: { issueId: created.data.id, body: expect.stringContaining("Cap the coupon") },
    });
    expect(api.calls.find((call) => call.operation === "DeevyLabelCreate")?.variables).toEqual({
      input: { name: "deevy:awaiting-approval", teamId: TEAM },
    });

    // Grace links her Linear account on Linear's own consent page.
    const { url } = await asGrace.identities.begin({ socketId });
    const state = new URL(url).searchParams.get("state") ?? "";
    const linked = await finishAccountLink(graceContext, {
      provider: "linear",
      code: "grace-consented",
      state,
    });
    expect(linked.location).toBe("https://deevy.test/settings/identities?linked=linear");

    // And rules by commenting where she read the Proposal.
    const ruled = await app.request(
      `/hooks/${socketId}`,
      await delivery("Comment", comment("/approve cap it at the basket total"), "d-2"),
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
    expect(await db.query.run.findFirst({ where: { id: run?.id ?? "" } })).toMatchObject({
      status: "active",
    });

    // What deevy says back: the arithmetic, and the label off.
    await sweep();
    const bodies = api.calls
      .filter((call) => call.operation === "DeevyCommentCreate")
      .map((call) => String((call.variables.input as { body: string }).body));
    expect(bodies.some((body) => body.includes("**Approved** at the `plan` Checkpoint"))).toBe(
      true,
    );
    expect(
      api.calls
        .filter((call) => call.operation === "DeevyLabelsChange")
        .map((call) => call.variables.input),
    ).toContainEqual({ addedLabelIds: [], removedLabelIds: ["label-1"] });
  });

  it("but a comment from an account nobody linked rules nothing, and is told where to link it", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, socketId, planner, asPlanner, sweep } = await workspaceOnLinear(db);
    await app.request(`/hooks/${socketId}`, await delivery("Issue", created, "d-1"));
    const run = await db.query.run.findFirst({ where: { agentMemberId: planner.id } });
    const gate = await asPlanner.gates.request({
      runId: run?.id ?? "",
      checkpoint: "plan",
      proposal: "Cap the coupon.",
    });

    await app.request(
      `/hooks/${socketId}`,
      await delivery(
        "Comment",
        comment("/approve", "9f8e7d6c-0000-4000-8000-00000000abcd", "A Stranger"),
        "d-2",
      ),
    );
    await sweep();

    expect(await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } })).toEqual([]);
    const reply = api.calls
      .filter((call) => call.operation === "DeevyCommentCreate")
      .map((call) => String((call.variables.input as { body: string }).body))
      .find((body) => body.includes("ruled nothing"));
    expect(reply).toContain("https://deevy.test/settings/identities");
  });

  it("and deevy's own comment coming back rules nothing, whatever it quotes", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, socketId, planner, asPlanner } = await workspaceOnLinear(db);
    await app.request(`/hooks/${socketId}`, await delivery("Issue", created, "d-1"));
    const run = await db.query.run.findFirst({ where: { agentMemberId: planner.id } });
    await asPlanner.gates.request({
      runId: run?.id ?? "",
      checkpoint: "plan",
      proposal: "Cap the coupon.",
    });
    const echoed = {
      ...comment("/approve", APP_USER, "deevy"),
      actor: { id: APP_USER, type: "OauthClient", name: "deevy" },
    };

    await app.request(`/hooks/${socketId}`, await delivery("Comment", echoed, "d-2"));

    expect(await db.query.gateDecision.findMany({})).toEqual([]);
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).not.toContain("gate.ruling_refused");
  });

  it("refuses a delivery that is stale or not Linear's, and writes neither down", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, socketId } = await workspaceOnLinear(db);
    const good = await delivery("Issue", created, "d-1");
    // Signed properly, five minutes ago: a replay of something once seen.
    const staleBody = JSON.stringify({ ...created, webhookTimestamp: Date.now() - 5 * 60_000 });

    const forged = await app.request(`/hooks/${socketId}`, {
      ...good,
      headers: { ...good.headers, "linear-signature": "deadbeef" },
    });
    const late = await app.request(`/hooks/${socketId}`, {
      ...good,
      body: staleBody,
      headers: { ...good.headers, "linear-signature": await sign(staleBody) },
    });

    expect(forged.status).toBe(401);
    expect(late.status).toBe(401);
    expect(await db.query.issue.findFirst({})).toBeUndefined();
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
  });
});

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

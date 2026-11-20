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
import { createLinearSocket, resetLinearTokens, socketModules } from "../src/index.ts";
import created from "./fixtures/linear/Issue.create.json" with { type: "json" };
import commented from "./fixtures/linear/Comment.create.json" with { type: "json" };

/**
 * Linear, through the door deevy actually serves (ADR-0024, ADR-0036).
 *
 * The module is proved against recorded payloads and a fake API in the other
 * `linear-*` tests. This puts the real module behind the real route with a
 * real database and replaces only Linear's API — so what is under test is the
 * whole sentence: somebody labels an issue in Linear, the Agent it names has a
 * Run, the Agent's Proposal appears on the issue as the app's comment with
 * where to rule on it, a `/approve` on the issue is a comment and nothing
 * more, and a Human rules in deevy and the issue is told.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  resetLinearTokens();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const webhookSecret = "lin_wh_the_app_and_deevy_share_this";
const ORG = created.organizationId;
const TEAM = created.data.teamId;
const APP_USER = "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9";
const GRACE = commented.data.userId;

/** Linear's API, as far as deevy can tell: every GraphQL call written down by name. */
function linearApi() {
  const calls: Array<{ operation: string; variables: Record<string, unknown> }> = [];
  let comments = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const raw = typeof init?.body === "string" ? init.body : "";
    if (url.endsWith("/oauth/token")) {
      const form = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ operation: `token:${form.grant_type ?? ""}`, variables: form });
      return Response.json({
        access_token: "lin_app_token",
        token_type: "Bearer",
        expires_in: 86_399,
      });
    }

    const { query, variables = {} } = JSON.parse(raw) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
    calls.push({ operation, variables });
    const data: Record<string, unknown> = {
      DeevyWho: {
        viewer: { id: APP_USER, name: "deevy", displayName: "deevy" },
        organization: { id: ORG, name: "Acme", urlKey: "acme" },
      },
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
 * Sponsor; Grace is the Human who comments on the issue, and rules in deevy.
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
  const extra = { sockets, socketSecret: sealing };
  const asPlanner = createRouterClient(router, {
    context: contextFor(db, planner, workspace, { ...extra, grantedProjectIds: [projectId] }),
  });
  const asGrace = createRouterClient(router, { context: contextFor(db, grace, workspace, extra) });
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return { db, app, api, socketId, workspace, ada, grace, planner, asPlanner, asGrace, sweep };
}

/** What deevy has said on the issue, in the order it said it. */
function saidOnLinear(api: ReturnType<typeof linearApi>): string[] {
  return api.calls
    .filter((call) => call.operation === "DeevyCommentCreate")
    .map((call) => String((call.variables.input as { body: string }).body));
}

/** The kinds of every Event written after the one at `seq`. */
async function kindsSince(db: Db, seq: number): Promise<string[]> {
  const since = await db.query.event.findMany({
    where: { seq: { gt: seq } },
    columns: { kind: true },
    orderBy: { seq: "asc" },
  });
  return since.map((event) => event.kind);
}

/** The last Event's place in the log, to read what follows it. */
async function lastSeq(db: Db): Promise<number> {
  const all = await db.query.event.findMany({ columns: { seq: true } });
  return Math.max(0, ...all.map((event) => event.seq));
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
  it("and the Agent it names has a Run, whose Gate is said on the issue and ruled on in deevy", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, socketId, planner, grace, asPlanner, asGrace, sweep } =
      await workspaceOnLinear(db);

    // The label routes it.
    const opened = await app.request(`/hooks/${socketId}`, await delivery("Issue", created, "d-1"));
    expect(await opened.json()).toMatchObject({ status: "applied", applied: 1 });
    const issue = await db.query.issue.findFirst({ where: { externalKey: "ENG-12" } });
    expect(issue).toMatchObject({ state: "open", stateName: "Todo", assigneeMemberId: planner.id });
    const run = await db.query.run.findFirst({ where: { agentMemberId: planner.id } });
    expect(run).toMatchObject({ status: "pending", trigger: "assignment" });

    // The Agent asks, and the Proposal becomes the app's comment on the issue,
    // with where to rule on it.
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
    const [announced] = saidOnLinear(api);
    expect(announced).toContain(`Rule on it in deevy: https://deevy.test/gates/${gate.id}`);
    expect(announced).not.toContain("/approve");

    // Grace answers where she read the Proposal, in words that once ruled:
    // they are a comment on the record, and the Gate goes on waiting.
    const before = await lastSeq(db);
    const commentedOn = await app.request(
      `/hooks/${socketId}`,
      await delivery("Comment", comment("/approve cap it at the basket total"), "d-2"),
    );
    expect(await commentedOn.json()).toMatchObject({ status: "applied", applied: 1 });
    expect(await kindsSince(db, before)).toEqual(["comment.created"]);
    expect(await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } })).toEqual([]);
    expect((await asGrace.gates.get({ requestId: gate.id })).status).toBe("open");
    // And deevy says nothing back to it.
    await sweep();
    expect(saidOnLinear(api)).toHaveLength(1);

    // She rules in deevy, signed in.
    await asGrace.gates.approve({ requestId: gate.id, note: "cap it at the basket total" });
    const [decision, ...others] = await db.query.gateDecision.findMany({
      where: { gateRequestId: gate.id },
    });
    expect(others).toEqual([]);
    expect(decision).toMatchObject({
      memberId: grace.id,
      decision: "approved",
      note: "cap it at the basket total",
    });
    expect(await db.query.run.findFirst({ where: { id: run?.id ?? "" } })).toMatchObject({
      status: "active",
    });

    // What deevy says back: the Ruling, as another comment, and nothing else
    // on the issue.
    await sweep();
    const ruled = saidOnLinear(api).at(-1);
    expect(ruled).toContain("**Approved** at the `plan` Checkpoint");
    expect(ruled).toContain("> cap it at the basket total");
    expect(
      api.calls
        .map((call) => call.operation)
        .filter((operation) => operation.startsWith("Deevy") && operation !== "DeevyWho"),
    ).toEqual(["DeevyCommentCreate", "DeevyCommentCreate"]);
  });

  it("and deevy's own comment coming back is no comment anybody made, whatever it quotes", async () => {
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
    const before = await lastSeq(db);

    const answered = await app.request(
      `/hooks/${socketId}`,
      await delivery("Comment", echoed, "d-2"),
    );

    expect(await answered.json()).toMatchObject({ status: "skipped" });
    expect(await kindsSince(db, before)).toEqual([]);
    expect(await db.query.gateDecision.findMany({})).toEqual([]);
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

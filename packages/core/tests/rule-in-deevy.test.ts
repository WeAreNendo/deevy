import { account } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { relayedProviders, signInProviders, type AuthProviders } from "../src/auth.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import type { InboundEvent, SocketModules } from "../src/sockets/port.ts";
import { deliverDueSocketMirrors } from "../src/work.ts";
import {
  agentContext,
  externalIssue,
  memberContext,
  testDb,
  testSealingSecret,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Ruling is made in deevy (docs/plans/simplify.md, slice 10; ADR-0036).
 *
 * The tool is told a Gate is waiting and how it was ruled on, and it links
 * back; nothing said in the tool rules. So a Human's accounts on the tools mean
 * nothing to deevy — there is no Identity to link and nothing that vouches —
 * and the one thing that says who a Human is, is how they sign in.
 */

const origin = "https://deevy.example.com";

/** A tracker with the three methods it must have, which keeps what deevy says on it. */
function tracker(): {
  sockets: SocketModules;
  comments: Array<{ externalId: string; body: string }>;
} {
  const comments: Array<{ externalId: string; body: string }> = [];
  const sockets: SocketModules = {
    stub: () => ({
      provider: "stub",
      capabilities: new Set(["tracker"] as const),
      webhookSecretFrom: "either",
      identity: () => Promise.resolve({ login: "deevy", id: "bot-1", mentionHandle: "@deevy" }),
      tracker: {
        verifyInbound: ({ headers, rawBody, webhookSecret }) =>
          Promise.resolve({
            ok: headers.get("x-test-signature") === `${webhookSecret}:${String(rawBody.length)}`,
            deliveryId: headers.get("x-test-delivery"),
            eventName: "events",
          }),
        normalize: (_eventName, payload) =>
          ((payload as { events: InboundEvent[] }).events ?? []).map((event) =>
            event.kind === "issue"
              ? { ...event, issue: { ...event.issue, updatedAt: new Date(event.issue.updatedAt) } }
              : event.kind === "comment"
                ? {
                    ...event,
                    comment: { ...event.comment, createdAt: new Date(event.comment.createdAt) },
                  }
                : event,
          ),
        createComment: (_scope, ref, body) => {
          comments.push({ externalId: ref.externalId, body });
          return Promise.resolve({
            externalId: `c${String(comments.length)}`,
            url: `${ref.url}#c${String(comments.length)}`,
          });
        },
      },
    }),
  };
  return { sockets, comments };
}

/**
 * A Gate an Agent is waiting at on record 7, in a Project bound to the tracker.
 * Ada is the admin, and signed in to deevy with GitHub as account 1001, which
 * before this slice was what let her rule from a tool whose accounts are
 * GitHub's.
 */
async function waiting() {
  const { db, close } = testDb();
  closers.push(close);
  const tool = tracker();
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  await db.insert(account).values({
    id: newId("account"),
    accountId: "1001",
    providerId: "github",
    userId: ada.member.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const asAda = createRouterClient(router, {
    context: { ...ada, sockets: tool.sockets, socketSecret: testSealingSecret },
  });
  const secret = "a-secret-the-tool-signs-with";
  const socket = await asAda.sockets.connect({
    provider: "stub",
    name: "The tracker",
    webhookSecret: secret,
  });
  const project = await asAda.projects.create({
    slug: "checkout",
    name: "Checkout",
    tracker: { socketId: socket.id, scope: { scopeKey: "acme/checkout" } },
  });
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [project.id],
  });
  const app = createApp({ db, sockets: tool.sockets, socketSecret: testSealingSecret });
  let deliveries = 0;
  const deliver = async (events: unknown[]) => {
    deliveries += 1;
    const body = JSON.stringify({ events });
    const response = await app.request(`/hooks/${socket.id}`, {
      method: "POST",
      headers: {
        "x-test-delivery": `delivery-${String(deliveries)}`,
        "x-test-signature": `${secret}:${String(body.length)}`,
      },
      body,
    });
    return (await response.json()) as { status: string };
  };
  await deliver([
    {
      kind: "issue",
      scopeKey: "acme/checkout",
      issue: externalIssue({ externalId: "7", key: "acme/checkout#7", labels: ["agent:planner"] }),
      actor: { login: "ada", id: "1001", isBot: false },
    },
  ]);
  const [run] = (await asAda.runs.list({})).runs;
  const asPlanner = createRouterClient(router, {
    context: { ...planner, sockets: tool.sockets, socketSecret: testSealingSecret },
  });
  const gate = await asPlanner.gates.request({
    runId: run?.id ?? "",
    checkpoint: "plan",
    proposal: "Cap the discount at the subtotal.",
  });
  const announce = () =>
    deliverDueSocketMirrors({
      db,
      workspaceId: ada.workspace.id,
      sockets: tool.sockets,
      socketSecret: testSealingSecret,
      baseUrl: origin,
    });
  return { db, app, ada, asAda, gate, tool, deliver, announce };
}

describe("a Gate on the record", () => {
  it("is announced with a link to rule on it in deevy, and nothing to type there", async () => {
    const { gate, tool, announce } = await waiting();

    await announce();

    const [said, ...more] = tool.comments;
    expect(more).toEqual([]);
    expect(said?.body).toContain("Cap the discount at the subtotal.");
    expect(said?.body).toContain(`${origin}/gates/${gate.id}`);
    expect(said?.body).not.toContain("/approve");
    expect(said?.body).not.toContain("/reject");
  });

  it("is not ruled by a comment that starts /approve, whoever wrote it, and nothing answers it", async () => {
    const { db, asAda, gate, tool, deliver, announce } = await waiting();
    await announce();
    const before = await db.query.event.findMany({ columns: { seq: true } });

    const delivered = await deliver([
      {
        kind: "comment",
        scopeKey: "acme/checkout",
        issueExternalId: "7",
        comment: {
          externalId: "c-ada",
          url: "https://tracker.test/acme/checkout/7#c-ada",
          body: "/approve\n\nReads right to me.",
          // Ada's own GitHub account, the one she signs in to deevy with.
          author: { login: "ada", id: "1001", isBot: false },
          createdAt: new Date().toISOString(),
        },
      },
    ]);
    expect(delivered.status).toBe("applied");

    expect((await asAda.gates.get({ requestId: gate.id })).status).toBe("open");
    const since = await db.query.event.findMany({
      where: { seq: { gt: Math.max(0, ...before.map((one) => one.seq)) } },
      columns: { kind: true },
    });
    expect(since.map((one) => one.kind)).toEqual(["comment.created"]);
    await announce();
    expect(tool.comments).toHaveLength(1);
  });

  it("is ruled in deevy, and the Ruling says nothing of a tool", async () => {
    const { asAda, gate, tool, announce } = await waiting();
    await announce();

    await asAda.gates.approve({ requestId: gate.id, note: "Reads right." });
    await announce();

    const [decision, ...others] = (await asAda.gates.get({ requestId: gate.id })).decisions;
    expect(others).toEqual([]);
    expect(decision).toMatchObject({ decision: "approved", note: "Reads right." });
    expect(decision).not.toHaveProperty("via");
    expect(decision).not.toHaveProperty("socket");
    expect(decision).not.toHaveProperty("verifiedBy");
    expect(tool.comments.at(-1)?.body).toContain("**Approved** at the `plan` Checkpoint");
  });
});

describe("a Human's accounts on the tools", () => {
  it("are nothing deevy links: Settings › Identities has no operations behind it", async () => {
    const { app } = await waiting();

    for (const path of [
      "/api/identities",
      "/api/identities/peek",
      "/api/identities/github/callback",
    ]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
    expect(Object.keys(router)).not.toContain("identities");
  });
});

describe("signing in", () => {
  /** Every provider deevy ever offered, configured, as an older environment would have them. */
  const everything = {
    github: { clientId: "github", clientSecret: "secret" },
    google: { clientId: "google", clientSecret: "secret" },
    microsoft: { clientId: "microsoft", clientSecret: "secret" },
    gitlab: { clientId: "gitlab", clientSecret: "secret" },
    linear: { clientId: "linear", clientSecret: "secret" },
    slack: { clientId: "slack", clientSecret: "secret" },
    atlassian: { clientId: "atlassian", clientSecret: "secret" },
    oidc: {
      clientId: "oidc",
      clientSecret: "secret",
      issuer: "https://idp.example.com",
    },
  } as unknown as AuthProviders;

  it("offers GitHub, Google, Microsoft and single sign-on, and no other provider", () => {
    expect(signInProviders({ providers: everything }).map((one) => one.id)).toEqual([
      "github",
      "google",
      "microsoft",
      "oidc",
    ]);
    expect(
      signInProviders({ providers: everything, signInOrder: ["linear", "slack", "google"] }).map(
        (one) => one.id,
      ),
    ).toEqual(["google", "github", "microsoft", "oidc"]);
  });

  it("is relayed for GitHub, Google and Microsoft", () => {
    expect(relayedProviders(everything)).toEqual(["github", "google", "microsoft"]);
  });

  it("admits a Human by their address's domain, and no longer by a GitHub organisation or a GitLab group", async () => {
    const { asAda } = await waiting();

    await expect(
      asAda.allowlist.add({ kind: "email_domain", value: "example.com" }),
    ).resolves.toMatchObject({ kind: "email_domain", value: "example.com" });
    for (const kind of ["github_org", "gitlab_group"]) {
      await expect(
        asAda.allowlist.add({ kind: kind as "email_domain", value: "acme" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});

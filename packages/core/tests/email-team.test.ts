import { notificationPreference, routingRule, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { deliverDueEmails } from "../src/email/deliver.ts";
import { renderEmail } from "../src/email/render.ts";
import type { EmailMessage, EmailSender, EmailSetup, SendResult } from "../src/email/port.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

/**
 * A team address as a Channel (docs/plans/email-channel.md, slice 2): an
 * admin routes kinds to it like a Slack room, and it is sent nothing until
 * somebody at it confirms by a link deevy mailed there, so deevy is never a
 * way to mail a stranger.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const baseUrl = "https://deevy.example.com";
const secret = "test-secret-test-secret-test-secret-1234";
const setup: EmailSetup = {
  sender: "resend",
  from: "deevy <deevy@example.com>",
  config: {},
  credentials: { apiKey: "re_test" },
};

function fakeSender(answer: SendResult = { delivered: true, status: 200 }) {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    kind: "resend",
    send: (message) => {
      sent.push(message);
      return Promise.resolve(answer);
    },
  };
  return { sent, emailSenders: { resend: () => sender } };
}

/** Ada the admin, with a sender configured, and a Planner whose Gates a team should hear about. */
async function adminWithSender(answer?: SendResult) {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const { sent, emailSenders } = fakeSender(answer);
  const { sockets } = fakeSockets();
  const context = { ...ada, sockets, emailSenders, email: setup, baseURL: baseUrl, secret };
  const asAda = createRouterClient(router, { context });
  const { project, record } = await seedProject(db, ada.workspace.id);
  const issue = await record({ externalId: "42", title: "Cap the coupon" });
  const planner = await agentContext(db, { sponsor: ada.member, grants: [project.id] });
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const run = await asPlanner.runs.start({ issue: issue.url });
  const app = createApp({ db, secret, baseURL: baseUrl });
  return { db, ada, asAda, asPlanner, run, sent, emailSenders, app, workspaceId: ada.workspace.id };
}

async function routeGatesTo(db: Db, workspaceId: string, channelId: string) {
  await db.insert(routingRule).values({
    id: newId("routingRule"),
    workspaceId,
    notificationKind: "gate_awaiting",
    projectId: null,
    channelId,
  });
}

/** The confirmation link in an email, as a path the app answers. */
const confirmPath = (message: EmailMessage | undefined) =>
  (/https:\/\/deevy\.example\.com(\/api\/email\/confirm\/\S+)/.exec(message?.text ?? "") ??
    [])[1] ?? "";

describe("a team address", () => {
  it("is mailed a confirmation the moment it is added, and says what the sender said", async () => {
    const { asAda, sent } = await adminWithSender();

    const added = await asAda.channels.createEmail({
      name: "Approvals",
      address: "approvals@example.com",
    });

    expect(added.channel).toMatchObject({
      kind: "email",
      name: "Approvals",
      address: "approvals@example.com",
      confirmedAt: null,
    });
    expect(added.confirmation).toEqual({ delivered: true, status: 200, error: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("approvals@example.com");
    expect(confirmPath(sent[0])).toMatch(/^\/api\/email\/confirm\//);
  });

  it("is still added when the sender refuses, with the refusal said", async () => {
    const { asAda } = await adminWithSender({
      delivered: false,
      retry: false,
      status: 403,
      error: "The example.com domain is not verified.",
    });

    const added = await asAda.channels.createEmail({ name: "Ops", address: "ops@example.com" });

    expect(added.confirmation).toEqual({
      delivered: false,
      status: 403,
      error: "The example.com domain is not verified.",
    });
    expect(added.channel.confirmedAt).toBeNull();
  });

  it("is sent nothing until confirmed, whatever the rules say", async () => {
    const { db, asAda, asPlanner, run, workspaceId } = await adminWithSender();
    const { channel } = await asAda.channels.createEmail({
      name: "Approvals",
      address: "approvals@example.com",
    });
    await routeGatesTo(db, workspaceId, channel.id);

    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    const owed = await db.query.delivery.findMany({ where: { target: "email" } });
    expect(owed).toEqual([]);
  });

  it("is confirmed by the link it was sent, opened then pressed, and then routed to", async () => {
    const { db, asAda, asPlanner, run, sent, emailSenders, app, workspaceId } =
      await adminWithSender();
    const { channel } = await asAda.channels.createEmail({
      name: "Approvals",
      address: "approvals@example.com",
    });
    await routeGatesTo(db, workspaceId, channel.id);
    const path = confirmPath(sent[0]);

    // Opening asks; a mail scanner opening it confirms nothing.
    const page = await app.request(path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<form");
    expect((await asAda.channels.list({})).channels[0]?.confirmedAt).toBeNull();

    const confirmed = await app.request(path, { method: "POST" });
    expect(confirmed.status).toBe(200);
    expect((await asAda.channels.list({})).channels[0]?.confirmedAt).toBeInstanceOf(Date);
    const events = await db.query.event.findMany({ where: { kind: "channel.confirmed" } });
    expect(events).toHaveLength(1);

    // Three Humans concerned by one Gate are one email in a room.
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    sent.length = 0;
    await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders, email: setup, secret });
    const toTeam = sent.filter((message) => message.to === "approvals@example.com");
    expect(toTeam).toHaveLength(1);
    // Written to a team, not to one person, and stopped where it was routed.
    expect(toTeam[0]?.subject).toMatch(/^Gate waiting:/);
    expect(toTeam[0]?.text).toContain("waiting for a Human");
    expect(toTeam[0]?.text).toContain(`${baseUrl}/settings/channels`);
    expect(toTeam[0]?.headers["List-Unsubscribe"]).toBeUndefined();
  });

  it("refuses a confirmation link that was changed or minted elsewhere", async () => {
    const { asAda, sent, app } = await adminWithSender();
    await asAda.channels.createEmail({ name: "Approvals", address: "approvals@example.com" });
    const path = confirmPath(sent[0]);

    for (const forged of [`${path}x`, "/api/email/confirm/nonsense"]) {
      expect((await app.request(forged, { method: "POST" })).status).toBe(400);
    }
    expect((await asAda.channels.list({})).channels[0]?.confirmedAt).toBeNull();
  });

  it("gets the confirmation again from Test while it waits, and a test email once confirmed", async () => {
    const { asAda, sent, app } = await adminWithSender();
    const { channel } = await asAda.channels.createEmail({
      name: "Approvals",
      address: "approvals@example.com",
    });

    await asAda.channels.test({ channelId: channel.id });
    expect(sent).toHaveLength(2);
    expect(confirmPath(sent[1])).toMatch(/^\/api\/email\/confirm\//);

    await app.request(confirmPath(sent[1]), { method: "POST" });
    const tested = await asAda.channels.test({ channelId: channel.id });
    expect(tested.delivered).toBe(true);
    expect(sent[2]?.subject).toMatch(/connected/i);
  });

  it("cannot be added without a sender, and says so", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: { ...ada, baseURL: baseUrl, secret } });

    await expect(
      asAda.channels.createEmail({ name: "Ops", address: "ops@example.com" }),
    ).rejects.toThrow(/No email sender is configured/);
  });

  it("is routed however a Human set their own Slack switch", async () => {
    // The Slack column is a Human's say over Slack, not over an admin's team address.
    const { db, ada, asAda, asPlanner, run, sent, app, workspaceId } = await adminWithSender();
    const { channel } = await asAda.channels.createEmail({
      name: "Approvals",
      address: "approvals@example.com",
    });
    await routeGatesTo(db, workspaceId, channel.id);
    await app.request(confirmPath(sent[0]), { method: "POST" });
    await db.insert(notificationPreference).values({
      memberId: ada.member.id,
      kind: "gate_awaiting",
      slack: false,
    });

    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    const owed = await db.query.delivery.findMany({ where: { target: "email" } });
    expect(owed).toHaveLength(1);
  });
});

describe("what a team address is told", () => {
  it("asks for an answer without saying it is the team's", () => {
    const said = renderEmail({
      kind: "run_awaiting_input",
      audience: "team",
      baseUrl,
      workspaceName: "Acme",
      issue: {
        id: "iss_1",
        key: "ENG-12",
        title: "Retry",
        url: "https://linear.app/acme/issue/ENG-12",
      },
      question: "Exponential or fixed?",
      runId: "run_1",
    });
    expect(said.subject).toBe("Waiting for an answer: ENG-12");
  });
});

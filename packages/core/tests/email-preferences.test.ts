import { notificationPreference, user as userTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { deliverDueEmails } from "../src/email/deliver.ts";
import type { EmailMessage, EmailSender, EmailSetup } from "../src/email/port.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

/**
 * A Human's say over what deevy emails them (docs/plans/email-channel.md,
 * slice 1): a switch per kind under Settings › Notifications, defaults that
 * email only what waits on them, and a one-click unsubscribe in every email
 * that turns off exactly that kind for exactly that Human.
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

function fakeSender() {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    kind: "resend",
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ delivered: true, status: 200 });
    },
  };
  return { sent, emailSenders: { resend: () => sender } };
}

/** Bob, whose address is verified, sponsors the Planner, so its Gates wait on him. */
async function bobAndHisPlanner() {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  await db
    .update(userTable)
    .set({ emailVerified: true })
    .where(eq(userTable.id, bob.member.userId));
  const { sockets } = fakeSockets();
  const { project, record } = await seedProject(db, ada.workspace.id);
  const issue = await record({ externalId: "42", title: "Cap the coupon" });
  const planner = await agentContext(db, { sponsor: bob.member, grants: [project.id] });
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const asBob = createRouterClient(router, { context: bob });
  const run = await asPlanner.runs.start({ issue: issue.url });
  return { db, ada, bob, asBob, asPlanner, run, workspaceId: ada.workspace.id };
}

async function owedTo(db: Db, memberId: string) {
  const rows = await db.query.delivery.findMany({ where: { target: "email_member" } });
  return rows.filter((row) => row.targetId === memberId);
}

describe("a Human's email switches", () => {
  it("start on for what waits on them and off for the rest, and say where email goes", async () => {
    const { asBob } = await bobAndHisPlanner();

    const { preferences, emailAddress } = await asBob.preferences.get({});

    expect(Object.fromEntries(preferences.map((row) => [row.kind, row.email]))).toEqual({
      mention: false,
      assignment: false,
      gate_awaiting: true,
      run_awaiting_input: true,
      run_finished: false,
      delegation: false,
    });
    expect(emailAddress).toBe("bob@example.com");
  });

  it("say there is nowhere to send when the sign-in did not verify the address", async () => {
    const { db } = await bobAndHisPlanner();
    const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });

    const { emailAddress } = await createRouterClient(router, { context: carol }).preferences.get(
      {},
    );

    expect(emailAddress).toBeNull();
  });

  it("decide what is owed: off stops a Gate, on starts a finished Run", async () => {
    const { db, bob, asBob, asPlanner, run } = await bobAndHisPlanner();
    const { preferences } = await asBob.preferences.get({});
    const flip = (kind: string, email: boolean) =>
      preferences.filter((row) => row.kind === kind).map((row) => ({ ...row, email }));
    await asBob.preferences.set({
      preferences: [...flip("gate_awaiting", false), ...flip("run_finished", true)],
    });

    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    expect(await owedTo(db, bob.member.id)).toEqual([]);

    await asPlanner.runs.finish({ runId: run.id, status: "completed", summary: "Done" });
    expect(await owedTo(db, bob.member.id)).toHaveLength(1);
  });

  it("keep their value when a caller leaves email out", async () => {
    const { db, bob, asBob } = await bobAndHisPlanner();
    await asBob.preferences.set({
      preferences: [{ kind: "mention", inbox: true, slack: true, email: true }],
    });

    // A client from before email: it says nothing about it.
    await asBob.preferences.set({ preferences: [{ kind: "mention", inbox: false, slack: true }] });

    const [row] = await db.query.notificationPreference.findMany({
      where: { memberId: bob.member.id, kind: "mention" },
    });
    expect(row).toMatchObject({ inbox: false, email: true });
  });
});

describe("the unsubscribe in every email", () => {
  /** Bob's Gate email, sent, and the link it carries. */
  async function sentToBob() {
    const world = await bobAndHisPlanner();
    await world.asPlanner.gates.request({
      runId: world.run.id,
      checkpoint: "plan",
      proposal: "Cap it.",
    });
    const { sent, emailSenders } = fakeSender();
    await deliverDueEmails({
      db: world.db,
      workspaceId: world.workspaceId,
      baseUrl,
      emailSenders,
      email: setup,
      secret,
    });
    const [message] = sent;
    const link = /^<(.+)>$/.exec(message?.headers["List-Unsubscribe"] ?? "")?.[1] ?? "";
    const app = createApp({ db: world.db, secret, baseURL: baseUrl });
    return { ...world, message, link, app };
  }

  async function emailFor(db: Db, memberId: string, kind: string) {
    const rows = await db.query.notificationPreference.findMany({ where: { memberId } });
    return rows.find((row) => row.kind === kind)?.email ?? null;
  }

  it("is a one-click unsubscribe, as RFC 8058 has it", async () => {
    const { message, link } = await sentToBob();

    expect(link).toMatch(new RegExp(`^${baseUrl}/api/email/unsubscribe/`));
    expect(message?.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // And a human-readable way to the same place, in the email itself.
    expect(message?.text).toContain(link);
  });

  it("turns off exactly that kind for exactly that Human when posted", async () => {
    const { db, bob, ada, link, app } = await sentToBob();
    await db.insert(notificationPreference).values({
      memberId: ada.member.id,
      kind: "gate_awaiting",
      email: true,
    });

    const answered = await app.request(link.replace(baseUrl, ""), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });

    expect(answered.status).toBe(200);
    expect(await emailFor(db, bob.member.id, "gate_awaiting")).toBe(false);
    expect(await emailFor(db, bob.member.id, "run_awaiting_input")).toBeNull();
    expect(await emailFor(db, ada.member.id, "gate_awaiting")).toBe(true);
  });

  it("changes nothing when merely opened, because mail scanners open every link", async () => {
    const { db, bob, link, app } = await sentToBob();

    const page = await app.request(link.replace(baseUrl, ""));

    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<form");
    // The kind by the name Settings › Notifications gives it.
    expect(html).toContain("“Gate awaiting”");
    expect(await emailFor(db, bob.member.id, "gate_awaiting")).toBeNull();
  });

  it("refuses a link that was not minted here, or was changed", async () => {
    const { db, bob, link, app } = await sentToBob();
    const path = link.replace(baseUrl, "");
    const tampered = path.replace("gate_awaiting", "run_finished");

    for (const forged of [tampered, "/api/email/unsubscribe/nonsense"]) {
      const answered = await app.request(forged, { method: "POST" });
      expect(answered.status).toBe(400);
    }
    expect(await emailFor(db, bob.member.id, "gate_awaiting")).toBeNull();
    expect(await emailFor(db, bob.member.id, "run_finished")).toBeNull();
  });

  it("is the same link on every attempt, so a retry is the same email", async () => {
    const world = await bobAndHisPlanner();
    await world.asPlanner.gates.request({
      runId: world.run.id,
      checkpoint: "plan",
      proposal: "Cap it.",
    });
    const seen: EmailMessage[] = [];
    const busy = {
      resend: () => ({
        kind: "resend" as const,
        send: (message: EmailMessage) => {
          seen.push(message);
          return Promise.resolve({
            delivered: false as const,
            retry: true,
            status: 429,
            error: "busy",
          });
        },
      }),
    };
    for (const minutes of [0, 5]) {
      await deliverDueEmails({
        db: world.db,
        workspaceId: world.workspaceId,
        baseUrl,
        emailSenders: busy,
        email: setup,
        secret,
        now: new Date(Date.now() + minutes * 60_000),
      });
    }
    expect(seen).toHaveLength(2);
    expect(seen[1]?.headers["List-Unsubscribe"]).toBe(seen[0]?.headers["List-Unsubscribe"]);
    expect(seen[1]?.idempotencyKey).toBe(seen[0]?.idempotencyKey);
  });
});

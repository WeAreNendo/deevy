import { invitation as invitationTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { EmailMessage, EmailSenders, EmailSetup } from "../src/email/port.ts";
import { limitWindowMs, type WorkspaceLimits } from "../src/limits.ts";
import { router } from "../src/operations/index.ts";
import { runDueWork } from "../src/work.ts";
import { memberContext, testDb, testSealingSecret } from "./helpers.ts";

/**
 * A Workspace's limits for the day (docs/plans/hosted.md, "Beta guardrails"):
 * configuration a deployment passes, absent on the image and the Worker. Every
 * hosted Workspace sends through one sender, so one of them mailing strangers
 * by the thousand would spend a quota and a reputation that are everybody's.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const baseUrl = "https://deevy.example.com";
const setup: EmailSetup = {
  sender: "resend",
  from: "deevy <deevy@example.com>",
  config: {},
  credentials: { apiKey: "re_test" },
};
const hour = 60 * 60_000;

async function workspace(limits?: WorkspaceLimits) {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const sent: EmailMessage[] = [];
  const emailSenders: EmailSenders = {
    resend: () => ({
      kind: "resend",
      send: (message) => {
        sent.push(message);
        return Promise.resolve({ delivered: true, status: 200 });
      },
    }),
  };
  const asAda = createRouterClient(router, {
    context: {
      ...ada,
      emailSenders,
      email: setup,
      socketSecret: testSealingSecret,
      baseURL: baseUrl,
      ...(limits ? { limits } : {}),
    },
  });
  /** One trigger of the background work, at `now`, under the same limits. */
  const sweep = (now: Date) =>
    runDueWork({
      db,
      now,
      baseUrl,
      emailSenders,
      email: setup,
      socketSecret: testSealingSecret,
      ...(limits ? { workspaceLimits: limits } : {}),
    });
  return { db, asAda, sent, sweep };
}

/** Moves an invitation's making back in time, which is how a test lets a day go by. */
async function madeAgo(db: ReturnType<typeof testDb>["db"], email: string, ms: number) {
  await db
    .update(invitationTable)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(invitationTable.email, email));
}

describe("a Workspace's invitations a day", () => {
  it("refuses the one past the limit, says when, and allows it once a day has gone by", async () => {
    const { db, asAda } = await workspace({ invitationsPerDay: 2 });
    await asAda.invitations.create({ email: "grace@example.com", send: false });
    await asAda.invitations.create({ email: "ken@example.com", send: false });

    const refused = asAda.invitations.create({ email: "lin@example.com", send: false });
    await expect(refused).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message:
        "This Workspace can make 2 invitations a day, and has. You can invite somebody again in about 24 hours.",
      data: { retryAt: expect.any(String) },
    });

    // A revoked invitation was still made, and most likely still mailed.
    const listed = await asAda.invitations.list({});
    const grace = listed.invitations.find((one) => one.email === "grace@example.com");
    await asAda.invitations.revoke({ invitationId: grace?.id ?? "" });
    await expect(
      asAda.invitations.create({ email: "lin@example.com", send: false }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    // The oldest leaves the window, and there is room for exactly one more.
    await madeAgo(db, "grace@example.com", limitWindowMs + 60_000);
    await madeAgo(db, "ken@example.com", 20 * hour);
    const made = await asAda.invitations.create({ email: "lin@example.com", send: false });
    expect(made.email).toBe("lin@example.com");
    await expect(
      asAda.invitations.create({ email: "max@example.com", send: false }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringMatching(/again in about 4 hours\.$/),
    });
  });

  it("refuses every one when the limit is nought", async () => {
    const { asAda } = await workspace({ invitationsPerDay: 0 });
    await expect(asAda.invitations.create({ email: "grace@example.com" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Invitations are turned off for this Workspace.",
    });
  });

  it("is no limit at all when the deployment sets none", async () => {
    const { asAda } = await workspace();
    for (let at = 0; at < 60; at += 1) {
      await asAda.invitations.create({ email: `person${String(at)}@example.com`, send: false });
    }
    expect((await asAda.invitations.list({})).invitations).toHaveLength(60);
  });
});

describe("a Workspace's emails a day", () => {
  it("sends as many as the day allows, keeps the rest as they were, and sends them when it can", async () => {
    const { db, asAda, sent, sweep } = await workspace({ emailsPerDay: 2 });
    for (const name of ["grace", "ken", "lin", "max", "nia"]) {
      await asAda.invitations.create({ email: `${name}@example.com` });
    }
    const start = new Date();

    expect((await sweep(start)).emails).toBe(2);
    expect(sent).toHaveLength(2);
    // Held, not failed and not given up on: nothing about the rows changed.
    const waiting = (await db.query.delivery.findMany({})).filter((row) => !row.deliveredAt);
    expect(waiting).toHaveLength(3);
    for (const row of waiting) {
      expect(row).toMatchObject({ attempts: 0, lastError: null, lockedUntil: null });
    }
    expect((await asAda.invitations.list({})).invitations.map((one) => one.emailStatus)).toEqual(
      expect.arrayContaining(["sent", "sent", "queued", "queued", "queued"]),
    );

    // Settings › Email says where the day stands, and when the rest go.
    const status = await asAda.email.status({});
    expect(status.limit).toMatchObject({ perDay: 2, sent: 2, waiting: 3 });
    expect(status.limit?.nextAt?.getTime()).toBe(start.getTime() + limitWindowMs);

    expect((await sweep(new Date(start.getTime() + 12 * hour))).emails).toBe(0);
    expect(sent).toHaveLength(2);

    // A day on, the window has room for two more; a day after that, the last.
    expect((await sweep(new Date(start.getTime() + limitWindowMs + 60_000))).emails).toBe(2);
    expect((await sweep(new Date(start.getTime() + 2 * limitWindowMs + 120_000))).emails).toBe(1);
    expect(new Set(sent.map((message) => message.to)).size).toBe(5);
  });

  it("sends everything owed when the deployment sets no limit, and Settings › Email says none", async () => {
    const { asAda, sent, sweep } = await workspace();
    for (const name of ["grace", "ken", "lin", "max", "nia"]) {
      await asAda.invitations.create({ email: `${name}@example.com` });
    }

    expect((await sweep(new Date())).emails).toBe(5);
    expect(sent).toHaveLength(5);
    expect((await asAda.email.status({})).limit).toBeNull();
  });
});

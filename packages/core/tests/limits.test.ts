import { invitation as invitationTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { limitWindowMs, type WorkspaceLimits } from "../src/limits.ts";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb } from "./helpers.ts";

/**
 * A Workspace's limits for the day (docs/plans/hosted.md, "Beta guardrails"):
 * configuration a deployment passes, absent on the image. Every hosted
 * Workspace is one of many on the same platform, so one of them inviting
 * strangers by the thousand would be everybody's problem.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const hour = 60 * 60_000;

async function workspace(limits?: WorkspaceLimits) {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const asAda = createRouterClient(router, {
    context: { ...ada, ...(limits ? { limits } : {}) },
  });
  return { db, asAda };
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
    await asAda.invitations.create({ email: "grace@example.com" });
    await asAda.invitations.create({ email: "ken@example.com" });

    const refused = asAda.invitations.create({ email: "lin@example.com" });
    await expect(refused).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message:
        "This Workspace can make 2 invitations a day, and has. You can invite somebody again in about 24 hours.",
      data: { retryAt: expect.any(String) },
    });

    // A revoked invitation was still made, and its link may already be out.
    const listed = await asAda.invitations.list({});
    const grace = listed.invitations.find((one) => one.email === "grace@example.com");
    await asAda.invitations.revoke({ invitationId: grace?.id ?? "" });
    await expect(asAda.invitations.create({ email: "lin@example.com" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });

    // The oldest leaves the window, and there is room for exactly one more.
    await madeAgo(db, "grace@example.com", limitWindowMs + 60_000);
    await madeAgo(db, "ken@example.com", 20 * hour);
    const made = await asAda.invitations.create({ email: "lin@example.com" });
    expect(made.email).toBe("lin@example.com");
    await expect(asAda.invitations.create({ email: "max@example.com" })).rejects.toMatchObject({
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
      await asAda.invitations.create({ email: `person${String(at)}@example.com` });
    }
    expect((await asAda.invitations.list({})).invitations).toHaveLength(60);
  });
});

import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { deliverDueEmails } from "../src/email/deliver.ts";
import type { EmailMessage, EmailSenders, EmailSetup, SendResult } from "../src/email/port.ts";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb, testSealingSecret } from "./helpers.ts";

/**
 * Invitations by email (docs/plans/email-channel.md, slice 6). The link's
 * token was only ever kept as a hash, so an emailed invitation carries it
 * sealed under `DEEVY_SECRET` until the email lands, and not a moment longer.
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

function senders(answer: SendResult = { delivered: true, status: 200 }) {
  const sent: EmailMessage[] = [];
  const emailSenders: EmailSenders = {
    resend: () => ({
      kind: "resend",
      send: (message) => {
        sent.push(message);
        return Promise.resolve(answer);
      },
    }),
  };
  return { sent, emailSenders };
}

async function adminInviting(
  options: { answer?: SendResult; email?: EmailSetup | null; socketSecret?: string | null } = {},
) {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const { sent, emailSenders } = senders(options.answer);
  const email = options.email === undefined ? setup : options.email;
  const socketSecret =
    options.socketSecret === undefined ? testSealingSecret : options.socketSecret;
  const asAda = createRouterClient(router, {
    context: {
      ...ada,
      emailSenders,
      ...(email ? { email } : {}),
      ...(socketSecret ? { socketSecret } : {}),
      baseURL: baseUrl,
    },
  });
  const sweep = () =>
    deliverDueEmails({
      db,
      workspaceId: ada.workspace.id,
      baseUrl,
      emailSenders,
      ...(email ? { email } : {}),
      ...(socketSecret ? { socketSecret } : {}),
    });
  return { db, asAda, sent, sweep };
}

describe("an invitation by email", () => {
  it("is queued as it is made, and the email's link is the one that accepts", async () => {
    const { db, asAda, sent, sweep } = await adminInviting();

    const made = await asAda.invitations.create({ email: "grace@example.com", role: "member" });
    expect(made.email).toBe("grace@example.com");
    expect(made.emailStatus).toBe("queued");
    expect(made.emailNotSent).toBeNull();

    await sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("grace@example.com");
    // The Workspace here is called deevy, so the subject does not say it twice.
    expect(sent[0]?.subject).toBe("Ada invited you to deevy");
    expect(sent[0]?.text).toContain(made.url);
    // Spent once it landed: the token is no longer kept, sealed or not.
    const [row] = await db.query.invitation.findMany({});
    expect(row?.sealedToken).toBeNull();
    expect((await asAda.invitations.list({})).invitations[0]).toMatchObject({
      emailStatus: "sent",
      emailError: null,
    });
  });

  it("never shows the sealed token in a read", async () => {
    const { db, asAda } = await adminInviting();
    await asAda.invitations.create({ email: "grace@example.com", role: "member" });
    const [row] = await db.query.invitation.findMany({});

    const listed = await asAda.invitations.list({});
    expect(row?.sealedToken).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain(row?.sealedToken ?? "nothing");
    expect(Object.keys(listed.invitations[0] ?? {})).not.toContain("sealedToken");
  });

  it("is not sent once the invitation was revoked, and the token goes with it", async () => {
    const { db, asAda, sent, sweep } = await adminInviting();
    const made = await asAda.invitations.create({ email: "grace@example.com", role: "member" });

    await asAda.invitations.revoke({ invitationId: made.id });
    await sweep();

    expect(sent).toEqual([]);
    const [row] = await db.query.invitation.findMany({});
    expect(row?.sealedToken).toBeNull();
  });

  it("says when the sender refused it, in the sender's words", async () => {
    const { asAda, sweep } = await adminInviting({
      answer: { delivered: false, retry: false, status: 422, error: "Invalid To address" },
    });
    await asAda.invitations.create({ email: "grace@example.com", role: "member" });

    await sweep();

    expect((await asAda.invitations.list({})).invitations[0]).toMatchObject({
      emailStatus: "failed",
      emailError: "Invalid To address",
    });
  });

  it("is only a link without a sender, or without DEEVY_SECRET to keep it, and says why", async () => {
    const noSender = await adminInviting({ email: null });
    const unsent = await noSender.asAda.invitations.create({ email: "grace@example.com" });
    expect(unsent).toMatchObject({
      emailStatus: null,
      emailNotSent: "No email sender is configured.",
    });
    expect(unsent.url).toMatch(/\/invite\//);

    const noSecret = await adminInviting({ socketSecret: null });
    expect(
      (await noSecret.asAda.invitations.create({ email: "grace@example.com" })).emailNotSent,
    ).toMatch(/DEEVY_SECRET/);
  });

  it("is only a link when the admin asks for that", async () => {
    const { asAda, sent, sweep } = await adminInviting();
    const made = await asAda.invitations.create({ email: "grace@example.com", send: false });
    await sweep();
    expect(made.emailStatus).toBeNull();
    expect(made.emailNotSent).toBeNull();
    expect(sent).toEqual([]);
  });
});

import { emailSender as emailSenderTable, user as userTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { deliverDueEmails } from "../src/email/deliver.ts";
import type { EmailMessage, EmailSenders, EmailSetup } from "../src/email/port.ts";
import { setupInForce } from "../src/email/settings.ts";
import { router } from "../src/operations/index.ts";
import {
  agentContext,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  testSealingSecret,
} from "./helpers.ts";

/**
 * Settings › Email (docs/plans/email-channel.md, slice 3): an admin chooses
 * the sender and pastes its key, sealed like a Socket's credentials, and it
 * wins over the environment's while it is set.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const baseUrl = "https://deevy.example.com";
const secret = "test-secret-test-secret-test-secret-1234";
const fromEnvironment: EmailSetup = {
  sender: "resend",
  from: "deevy <env@example.com>",
  config: {},
  credentials: { apiKey: "re_from_environment" },
};

/** Senders that record which key built them and what they sent. */
function recordingSenders() {
  const sent: Array<EmailMessage & { key: string }> = [];
  const emailSenders: EmailSenders = {
    resend: ({ credentials }) => {
      if (!credentials.apiKey) throw new Error("Resend needs an API key (RESEND_API_KEY).");
      return {
        kind: "resend",
        send: (message) => {
          sent.push({ ...message, key: credentials.apiKey ?? "" });
          return Promise.resolve({ delivered: true, status: 200 });
        },
      };
    },
  };
  return { sent, emailSenders };
}

async function admin({ environment = fromEnvironment as EmailSetup | null } = {}) {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  await db
    .update(userTable)
    .set({ emailVerified: true })
    .where(eq(userTable.id, ada.member.userId));
  const { sent, emailSenders } = recordingSenders();
  const context = {
    ...ada,
    emailSenders,
    ...(environment ? { email: environment } : {}),
    socketSecret: testSealingSecret,
    baseURL: baseUrl,
    secret,
  };
  return { db, ada, sent, emailSenders, context, asAda: createRouterClient(router, { context }) };
}

describe("the sender in force", () => {
  it("is the environment's until an admin sets one, and says where it came from", async () => {
    const { asAda } = await admin();

    expect(await asAda.email.status({})).toMatchObject({
      sender: "resend",
      from: "deevy <env@example.com>",
      source: "environment",
      runnable: true,
      problem: null,
      available: ["resend"],
    });
  });

  it("is the one set in Settings, with its key sealed and never shown", async () => {
    const { db, asAda, context } = await admin();

    await asAda.email.configure({
      sender: "resend",
      from: "deevy <settings@example.com>",
      config: {},
      credentials: { apiKey: "re_from_settings" },
    });

    const status = await asAda.email.status({});
    expect(status).toMatchObject({ source: "settings", from: "deevy <settings@example.com>" });
    expect(JSON.stringify(status)).not.toContain("re_from_settings");
    const [row] = await db.select().from(emailSenderTable);
    expect(row?.credentials).not.toContain("re_from_settings");
    expect(
      (
        await setupInForce({
          db,
          workspaceId: context.workspace.id,
          socketSecret: testSealingSecret,
        })
      ).setup,
    ).toMatchObject({ credentials: { apiKey: "re_from_settings" } });
    const events = await db.query.event.findMany({ where: { kind: "email.configured" } });
    expect(JSON.stringify(events)).not.toContain("re_from_settings");
  });

  it("is what the sweep sends through, and the environment's again once cleared", async () => {
    const { db, ada, asAda, sent, emailSenders } = await admin();
    await asAda.email.configure({
      sender: "resend",
      from: "deevy <settings@example.com>",
      config: {},
      credentials: { apiKey: "re_from_settings" },
    });
    const { sockets } = fakeSockets();
    const { project, record } = await seedProject(db, ada.workspace.id);
    const issue = await record({ externalId: "42", title: "Cap the coupon" });
    const planner = await agentContext(db, { sponsor: ada.member, grants: [project.id] });
    const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
    const run = await asPlanner.runs.start({ issue: issue.url });
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    await deliverDueEmails({
      db,
      workspaceId: ada.workspace.id,
      baseUrl,
      emailSenders,
      email: fromEnvironment,
      socketSecret: testSealingSecret,
    });
    expect(sent.map((one) => one.key)).toEqual(["re_from_settings"]);

    await asAda.email.clear({});
    expect(await asAda.email.status({})).toMatchObject({ source: "environment" });
  });

  it("keeps the saved key when an admin changes only the From", async () => {
    const { asAda, sent } = await admin();
    await asAda.email.configure({
      sender: "resend",
      from: "deevy <one@example.com>",
      config: {},
      credentials: { apiKey: "re_from_settings" },
    });

    await asAda.email.configure({
      sender: "resend",
      from: "deevy <two@example.com>",
      config: {},
      credentials: {},
    });
    await asAda.email.test({});

    expect(sent[0]?.key).toBe("re_from_settings");
    expect(sent[0]?.from).toEqual({ address: "two@example.com", name: "deevy" });
  });

  it("refuses a sender that cannot be built, and one this runtime cannot run", async () => {
    const { asAda } = await admin();

    await expect(
      asAda.email.configure({
        sender: "resend",
        from: "deevy@example.com",
        config: {},
        credentials: {},
      }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    await expect(
      asAda.email.configure({
        sender: "smtp",
        from: "deevy@example.com",
        config: {},
        credentials: { url: "smtp://localhost" },
      }),
    ).rejects.toThrow(/cannot run on this deployment/);
  });

  it("is said to be missing when neither Settings nor the environment set one", async () => {
    const { asAda } = await admin({ environment: null });

    expect(await asAda.email.status({})).toMatchObject({
      sender: null,
      source: null,
      runnable: false,
      problem: "No email sender is configured.",
    });
  });
});

describe("a test email", () => {
  it("goes to the admin who asked, at their verified address, and says what came back", async () => {
    const { asAda, sent } = await admin();

    expect(await asAda.email.test({})).toEqual({
      delivered: true,
      status: 200,
      error: null,
      to: "ada@example.com",
    });
    expect(sent[0]?.to).toBe("ada@example.com");
  });
});

describe("who may touch it", () => {
  it("is admins only", async () => {
    const { db } = await admin();
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const asBob = createRouterClient(router, { context: bob });

    await expect(asBob.email.status({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

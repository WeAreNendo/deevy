import { user as userTable, workspace as workspaceTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { EmailMessage, EmailSender, EmailSetup, SendResult } from "../src/email/port.ts";
import { deliverDueEmails } from "../src/email/deliver.ts";
import { renderEmail } from "../src/email/render.ts";
import { routeEvent } from "../src/notifications.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

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

/**
 * A sender that keeps what it was asked to send, answering what the test
 * says: delivered unless told otherwise.
 */
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

async function verify(db: Db, userId: string) {
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, userId));
}

/**
 * Ada the admin and Bob, the Human the Planner works for: Bob sponsors it, so
 * a Gate it asks for waits on him (notifications.ts). Bob's address is
 * verified unless a test says otherwise.
 */
async function waitingOnBob({ verified = true } = {}) {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  if (verified) await verify(db, bob.member.userId);
  const { sockets } = fakeSockets();
  const { project, record } = await seedProject(db, ada.workspace.id);
  const issue = await record({ externalId: "42", title: "Cap the coupon at the basket total" });
  const planner = await agentContext(db, { sponsor: bob.member, grants: [project.id] });
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const run = await asPlanner.runs.start({ issue: issue.url });
  return { db, ada, bob, issue, asPlanner, run, workspaceId: ada.workspace.id };
}

async function emailsOwed(db: Db) {
  const rows = await db.query.delivery.findMany({});
  return rows.filter((row) => row.target === "email_member");
}

describe("a Notification for a Human's email", () => {
  it("is owed for a Gate, to the verified address of the Human it waits on", async () => {
    const { db, bob, asPlanner, run } = await waitingOnBob();

    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    const owed = await emailsOwed(db);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({
      targetId: bob.member.id,
      recipientMemberId: bob.member.id,
    });
  });

  it("is never owed to an address the sign-in did not verify", async () => {
    const { db, asPlanner, run } = await waitingOnBob({ verified: false });

    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    expect(await emailsOwed(db)).toEqual([]);
  });

  it("is owed only for what waits on them until they say otherwise", async () => {
    const { db, asPlanner, run } = await waitingOnBob();

    // A finished Run tells its Human, and is off by email until they turn it on.
    await asPlanner.runs.finish({ runId: run.id, status: "completed", summary: "Done" });

    const events = await db.query.event.findMany({ where: { kind: "run.completed" } });
    const routing = await routeEvent(db, events[0] as never);
    expect(routing.inbox.length).toBeGreaterThan(0);
    expect(routing.emails).toEqual([]);
    expect(await emailsOwed(db)).toEqual([]);
  });
});

describe("delivering what is owed by email", () => {
  it("sends the Gate to the Human, with the Proposal's first lines and a link to rule", async () => {
    const { db, issue, asPlanner, run, workspaceId } = await waitingOnBob();
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "## What I will do\n\nCap the coupon at the basket total.",
    });
    const { sent, emailSenders } = fakeSender();

    const result = await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders, email: setup });

    expect(result).toMatchObject({ delivered: 1, failed: 0, gaveUp: 0 });
    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message?.to).toBe("bob@example.com");
    expect(message?.from).toEqual({ address: "deevy@example.com", name: "deevy" });
    expect(message?.subject).toBe(`Gate waiting: ${issue.externalKey} · plan`);
    expect(message?.text).toContain("Cap the coupon at the basket total.");
    expect(message?.text).toContain(`${baseUrl}/gates/${gate.id}`);
    expect(message?.html).toContain(`href="${baseUrl}/gates/${gate.id}"`);
    // Keyed by the delivery, so a retry is the same email to a sender that deduplicates.
    const [row] = await emailsOwed(db);
    expect(message?.idempotencyKey?.startsWith(`${row?.id ?? "?"}.`)).toBe(true);
    expect(row?.deliveredAt).toBeInstanceOf(Date);
  });

  it("tries again later when the sender asks for time", async () => {
    const { db, asPlanner, run, workspaceId } = await waitingOnBob();
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    const { emailSenders } = fakeSender({
      delivered: false,
      retry: true,
      status: 429,
      error: "Too many requests.",
    });
    const now = new Date();

    const result = await deliverDueEmails({
      db,
      workspaceId,
      baseUrl,
      emailSenders,
      email: setup,
      now,
    });

    expect(result).toMatchObject({ delivered: 0, failed: 1, gaveUp: 0 });
    const [row] = await emailsOwed(db);
    expect(row).toMatchObject({ attempts: 1, deliveredAt: null, lastStatus: 429 });
    expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(await db.query.event.findMany({ where: { kind: "email.exhausted" } })).toEqual([]);
  });

  it("gives up at once on what waiting cannot fix, and says so in the Event log", async () => {
    const { db, asPlanner, run, workspaceId } = await waitingOnBob();
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    const { emailSenders } = fakeSender({
      delivered: false,
      retry: false,
      status: 403,
      error: "The example.com domain is not verified.",
    });

    const result = await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders, email: setup });

    expect(result).toMatchObject({ delivered: 0, gaveUp: 1 });
    const [row] = await emailsOwed(db);
    expect(row?.lastError).toBe("The example.com domain is not verified.");
    // Nothing will look at it again.
    expect(
      await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders, email: setup }),
    ).toMatchObject({ scanned: 0 });
    const exhausted = await db.query.event.findMany({ where: { kind: "email.exhausted" } });
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]?.payload).toMatchObject({
      status: 403,
      error: "The example.com domain is not verified.",
    });
  });

  it("sends nothing and keeps nothing waiting when no sender is configured", async () => {
    const { db, asPlanner, run, workspaceId } = await waitingOnBob();
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    const result = await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders: {} });

    // Retired rather than kept: a sender configured next week must not send a
    // week of stale Gates in one go.
    expect(result).toMatchObject({ delivered: 0, gaveUp: 1 });
    const [row] = await emailsOwed(db);
    expect(row?.lastError).toMatch(/no email sender/i);
  });

  it("retires an email whose sender this runtime cannot run, naming it", async () => {
    const { db, asPlanner, run, workspaceId } = await waitingOnBob();
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    await deliverDueEmails({
      db,
      workspaceId,
      baseUrl,
      emailSenders: {},
      email: { ...setup, sender: "smtp" },
    });

    const [row] = await emailsOwed(db);
    expect(row?.lastError).toMatch(/smtp/i);
  });
});

describe("an email about something already settled", () => {
  it("is not sent once the Gate was ruled on, since an email cannot be taken back", async () => {
    const { db, bob, asPlanner, run, workspaceId } = await waitingOnBob();
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap it.",
    });
    const asBob = createRouterClient(router, { context: bob });
    await asBob.gates.approve({ requestId: gate.id, note: "Fine." });
    const { sent, emailSenders } = fakeSender();

    const result = await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders, email: setup });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ delivered: 0, gaveUp: 1 });
    const [row] = await emailsOwed(db);
    expect(row?.lastError).toMatch(/no longer waiting/);
    // Not an operator's problem: nothing failed.
    expect(await db.query.event.findMany({ where: { kind: "email.exhausted" } })).toEqual([]);
  });
});

describe("what an email says", () => {
  it("cuts a long Proposal and escapes what it quotes", () => {
    const said = renderEmail({
      kind: "gate_awaiting",
      baseUrl,
      workspaceName: "Acme",
      issue: {
        id: "iss_1",
        key: "acme/deevy#42",
        title: "Totals <wrong> & odd",
        url: "https://github.com/acme/deevy/issues/42",
      },
      gate: {
        id: "gate_1",
        checkpoint: "plan",
        proposal: `${"word ".repeat(400)}tail`,
        agentName: "Planner",
        approvals: 0,
        required: 2,
      },
    });

    expect(said.text).not.toContain("tail");
    expect(said.text).toContain("…");
    expect(said.html).toContain("Totals &lt;wrong&gt; &amp; odd");
    expect(said.html).not.toContain("<wrong>");
    expect(said.text).toContain("0 of 2 approvals");
    // Why it came, and where to stop it.
    expect(said.text).toContain(`${baseUrl}/settings/notifications`);
  });

  it("quotes a Proposal as prose, not as the markdown it was written in", () => {
    const said = renderEmail({
      kind: "gate_awaiting",
      baseUrl,
      workspaceName: "Acme",
      issue: null,
      gate: {
        id: "gate_1",
        checkpoint: "plan",
        proposal:
          "## What I will do\n\nRead `/approve` off a comment, check it was\nsigned, and **rule** as [the Human](https://example.com/h).\n\n- one\n- two",
        agentName: "Planner",
        approvals: 0,
        required: 1,
      },
    });

    expect(said.text).toContain("What I will do");
    expect(said.text).not.toContain("##");
    expect(said.text).not.toContain("`");
    expect(said.text).not.toContain("**");
    expect(said.text).toContain("check it was signed, and rule as the Human.");
    expect(said.text).toContain("• one");
  });

  it("quotes the question a Run waits on", () => {
    const said = renderEmail({
      kind: "run_awaiting_input",
      baseUrl,
      workspaceName: "Acme",
      issue: {
        id: "iss_1",
        key: "ENG-12",
        title: "Retry the import",
        url: "https://linear.app/acme/issue/ENG-12",
      },
      question: "Exponential or fixed backoff?",
      runId: "run_1",
    });

    expect(said.subject).toBe("Waiting for your answer: ENG-12");
    expect(said.text).toContain("Exponential or fixed backoff?");
    expect(said.text).toContain(`${baseUrl}/runs/run_1`);
  });
});

/** A database that says what it was asked to do (notifications.test.ts has the same). */
function countingDb(db: Db) {
  const statements: string[] = [];
  const starters = new Set(["select", "insert", "update", "delete", "run", "all", "get", "batch"]);
  const counted = new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property === "query") statements.push("query");
      if (typeof property !== "string" || !starters.has(property)) return value;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        statements.push(property);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Db;
  return { counted, statements };
}

describe("a pass over what is owed by email", () => {
  it("costs the same statements for one email as for three", async () => {
    const count = async (checkpoints: string[]) => {
      const { db, asPlanner, run, workspaceId } = await waitingOnBob();
      for (const checkpoint of checkpoints) {
        await asPlanner.gates.request({ runId: run.id, checkpoint, proposal: `At ${checkpoint}.` });
      }
      const { counted, statements } = countingDb(db);
      const { emailSenders } = fakeSender();
      const result = await deliverDueEmails({
        db: counted,
        workspaceId,
        baseUrl,
        emailSenders,
        email: setup,
      });
      return { result, statements };
    };

    const one = await count(["plan"]);
    const three = await count(["plan", "review", "ship"]);

    expect(one.result.delivered).toBe(1);
    expect(three.result.delivered).toBe(3);
    expect(three.statements).toEqual(one.statements);
  });
});

describe("an email tried twice", () => {
  it("keeps its key while it says the same thing, and takes a new one when it changed", async () => {
    // Resend refuses a key reused with a different body, as a permanent 409;
    // a retry of the same email must dedupe, and a changed one must not collide.
    const { db, asPlanner, run, workspaceId } = await waitingOnBob();
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    const keys: string[] = [];
    const busy = {
      resend: () => ({
        kind: "resend" as const,
        send: (message: EmailMessage) => {
          keys.push(message.idempotencyKey ?? "");
          return Promise.resolve({
            delivered: false as const,
            retry: true,
            status: 429,
            error: "busy",
          });
        },
      }),
    };
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    await deliverDueEmails({ db, workspaceId, baseUrl, emailSenders: busy, email: setup });
    await deliverDueEmails({
      db,
      workspaceId,
      baseUrl,
      emailSenders: busy,
      email: setup,
      now: later(5),
    });
    await db.update(workspaceTable).set({ name: "Renamed" });
    await deliverDueEmails({
      db,
      workspaceId,
      baseUrl,
      emailSenders: busy,
      email: setup,
      now: later(30),
    });

    const [row] = await db.query.delivery.findMany({ where: { target: "email_member" } });
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys.every((key) => key.startsWith(`${row?.id ?? "?"}.`))).toBe(true);
  });
});

describe("a pass that gives up on emails", () => {
  it("records them in batches D1 can bind, and costs the same for one as for three", async () => {
    const count = async (checkpoints: string[]) => {
      const { db, asPlanner, run, workspaceId } = await waitingOnBob();
      for (const checkpoint of checkpoints) {
        await asPlanner.gates.request({ runId: run.id, checkpoint, proposal: `At ${checkpoint}.` });
      }
      const { counted, statements } = countingDb(db);
      const { emailSenders } = fakeSender({
        delivered: false,
        retry: false,
        status: 403,
        error: "The example.com domain is not verified.",
      });
      const result = await deliverDueEmails({
        db: counted,
        workspaceId,
        baseUrl,
        emailSenders,
        email: setup,
      });
      const events = await db.query.event.findMany({ where: { kind: "email.exhausted" } });
      return { result, statements, events };
    };

    const one = await count(["plan"]);
    const three = await count(["plan", "review", "ship"]);

    expect(three.result.gaveUp).toBe(3);
    expect(three.events).toHaveLength(3);
    expect(three.statements).toEqual(one.statements);
    // Seventeen Events at six columns each is past D1's hundred bound
    // parameters in one statement, so they go in two.
    const many = await count(Array.from({ length: 17 }, (_, at) => `step-${String(at)}`));
    expect(many.events).toHaveLength(17);
    const inserts = (statements: string[]) => statements.filter((one) => one === "insert").length;
    expect(inserts(many.statements)).toBe(inserts(one.statements) + 1);
  });
});

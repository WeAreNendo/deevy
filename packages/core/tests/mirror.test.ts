import { project as projectTable, socket as socketTable, type Db, type Socket } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { applyInbound } from "../src/sockets/apply.ts";
import { deliverDueSocketMirrors } from "../src/work.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * What deevy says back where the work lives (ADR-0024).
 *
 * The point of mirroring is that a team never has to come to deevy to follow
 * along: the Gate an Agent is waiting at, and the ruling that let it past,
 * both show up as comments on the record itself. The danger is equally plain —
 * deevy writes a comment, the tracker tells deevy about it, and deevy acts on
 * its own words — so the loop guard is tested here as well as at the door.
 */
async function mirroring(db: Db, mirror: "off" | "gates" | "runs" = "gates") {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, ada.workspace.id);
  const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const fake = fakeSockets();
  await db.update(projectTable).set({ mirror }).where(eq(projectTable.id, seeded.project.id));

  const asPlanner = createRouterClient(router, { context: { ...planner, sockets: fake.sockets } });
  const asBob = createRouterClient(router, {
    context: {
      ...(await memberContext(db, { name: "Bob", email: "bob@example.com" })),
      sockets: fake.sockets,
    },
  });
  const run = await asPlanner.runs.start({ issue: issue.url });

  return {
    ada,
    seeded,
    issue,
    run,
    fake,
    asPlanner,
    asBob,
    send: () =>
      deliverDueSocketMirrors({
        db,
        workspaceId: ada.workspace.id,
        sockets: fake.sockets,
        baseUrl: "https://deevy.test",
      }),
    owed: async () => db.query.delivery.findMany({ where: { target: "socket" } }),
  };
}

describe("a Gate on a Project that mirrors", () => {
  it("is a comment on the record, and a label that says it is waiting", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run, fake, send, owed } = await mirroring(db);

    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "## What I will do\n\nCap the coupon at the basket total.",
      links: [{ url: "https://github.test/acme/deevy/pull/7", title: "Pull request 7" }],
    });
    expect(await owed()).toHaveLength(1);

    const sent = await send();

    expect(sent.delivered).toBe(1);
    const [comment] = fake.comments;
    expect(comment?.externalId).toBe("42");
    // Everything a Human needs to rule without opening deevy, and the way in
    // when they would rather.
    expect(comment?.body).toContain("ship");
    expect(comment?.body).toContain("Cap the coupon at the basket total");
    expect(comment?.body).toContain("Pull request 7");
    expect(comment?.body).toContain("/approve");
    expect(comment?.body).toContain(`https://deevy.test/gates/${asked.id}`);
    // The tracker shows the App as the author, so the line says who spoke.
    expect(comment?.body).toContain("— Planner");
    expect(comment?.body).toContain(run.id);
    expect(fake.labels[0]).toMatchObject({
      externalId: "42",
      add: ["deevy:awaiting-approval"],
      remove: [],
    });
  });

  it("says the arithmetic on the way to a ruling, and takes the label off at it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, asBob, run, fake, send } = await mirroring(db);
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await send();
    fake.comments.length = 0;
    fake.labels.length = 0;

    await asBob.gates.approve({ requestId: asked.id, note: "Reads right" });
    await send();

    const said = fake.comments.map((one) => one.body).join("\n");
    expect(said).toContain("Approved");
    expect(said).toContain("Reads right");
    expect(said).toContain("1 of 1");
    // The record stops saying it is waiting, because it is not.
    expect(fake.labels.at(-1)).toMatchObject({ remove: ["deevy:awaiting-approval"] });
  });
});

describe("how much a Project says back", () => {
  it("is nothing at all when it says nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run, owed } = await mirroring(db, "off");

    await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });

    expect(await owed()).toEqual([]);
  });

  it("leaves a Run out where a Project mirrors Gates alone", async () => {
    const { db, close } = testDb();
    closers.push(close);
    // A Run starting is not a decision anybody has to make, so a Project that
    // mirrors Gates says nothing about it.
    const quiet = await mirroring(db, "gates");

    expect(await quiet.owed()).toEqual([]);
  });

  it("carries one where a Project mirrors Runs as well", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const loud = await mirroring(db, "runs");
    expect(await loud.owed()).toHaveLength(1);

    const sent = await loud.send();

    expect(sent.delivered).toBe(1);
    expect(loud.fake.comments[0]?.body).toContain("started");
  });
});

/**
 * A pull request, said on the record where the tracker cannot see it for
 * itself (docs/plans/sockets.md, "Mirroring"). GitHub shows a pull request on
 * the issue its body closes; Linear and Notion know nothing about a repository
 * they are not.
 */
describe("a pull request on a Project that mirrors Runs", () => {
  async function opened(db: Db, options: { forgeIsTracker: boolean; mirror?: "gates" | "runs" }) {
    const mirrored = await mirroring(db, options.mirror ?? "runs");
    if (options.forgeIsTracker) {
      await db
        .update(projectTable)
        .set({ forgeSocketId: mirrored.seeded.socketId, forgeScope: { scopeKey: "acme/deevy" } })
        .where(eq(projectTable.id, mirrored.seeded.project.id));
    }
    await mirrored.asPlanner.links.add({
      issue: mirrored.issue.url,
      url: "https://github.com/acme/deevy/pull/7",
      title: "Cap the coupon at the basket total",
      runId: mirrored.run.id,
    });
    return mirrored;
  }

  it("is a comment where the tracker is not where the code is", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { owed, send, fake, run } = await opened(db, { forgeIsTracker: false });
    // The Run starting, and the pull request.
    expect(await owed()).toHaveLength(2);

    await send();

    const said = fake.comments.find((comment) => comment.body.includes("pull request"));
    expect(said?.body).toContain(
      "[Cap the coupon at the basket total](https://github.com/acme/deevy/pull/7)",
    );
    // Signed like every mirrored comment, with the Run that opened it.
    expect(said?.body).toContain(`— Planner · ${run.id} · via deevy`);
  });

  it("is nothing where the tracker is the forge too, which shows it already", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { owed } = await opened(db, { forgeIsTracker: true });

    expect(await owed()).toHaveLength(1);
  });

  it("is nothing where a Project mirrors Gates alone", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { owed } = await opened(db, { forgeIsTracker: false, mirror: "gates" });

    expect(await owed()).toEqual([]);
  });
});

describe("a Socket that stops taking them", () => {
  it("retires what it was owed rather than trying for ever", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run, seeded, send, owed } = await mirroring(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });

    await db
      .update(socketTable)
      .set({ status: "paused" })
      .where(eq(socketTable.id, seeded.socketId));
    const sent = await send();

    expect(sent.gaveUp).toBe(1);
    expect((await owed())[0]?.deliveredAt).toBeNull();
    // Retired, not retried: a rested Socket is an operator's decision, and a
    // queue of comments waiting to land on it is not what they asked for.
    expect((await owed())[0]?.attempts).toBeGreaterThan(0);
  });
});

describe("the loop deevy must not close", () => {
  it("ignores its own mirrored comment when the tracker tells it about one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, run, fake, seeded, send } = await mirroring(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });
    await send();
    const mirrored = fake.comments[0]?.body ?? "";
    expect(mirrored).toContain("via deevy");

    const before = (await db.query.event.findMany({})).length;
    const socket = (await db.query.socket.findFirst({ where: { id: seeded.socketId } })) as Socket;
    // The tracker tells deevy what deevy just said. Every provider does this,
    // and acting on it is a loop between deevy and somebody else's API.
    const result = await applyInbound({
      db,
      workspace: ada.workspace,
      socket,
      events: [
        {
          kind: "comment",
          scopeKey: "acme/deevy",
          issueExternalId: "42",
          comment: {
            externalId: "c1",
            url: "https://tracker.test/acme/deevy#42-c1",
            body: mirrored,
            author: { ...socket.identity, isBot: true },
            createdAt: new Date(),
          },
        },
      ],
    });

    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toContain("itself");
    expect((await db.query.event.findMany({})).length).toBe(before);
  });
});

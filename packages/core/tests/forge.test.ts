import { createRouterClient } from "@orpc/server";
import { project as projectTable } from "@deevy/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { branchFor, pullBody, titleFor } from "../src/forge.ts";
import { router } from "../src/operations/index.ts";
import {
  agentContext,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  type MemberContext,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * The code half of a Run (ADR-0014, ADR-0019, ADR-0024).
 *
 * An Agent clones with a credential deevy mints per Run and opens the pull
 * request through deevy rather than with a token of its own. What these hold
 * is the line that matters: the token reaches the supervisor and nothing else
 * — not an Event, not a read, not a log — and a Run may only speak for itself.
 */
async function workspace(db: MemberContext["db"], options: { forge?: boolean } = {}) {
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
  const { sockets } = fakeSockets();
  if (options.forge !== false) {
    await db
      .update(projectTable)
      .set({
        forgeSocketId: seeded.socketId,
        forgeScope: { scopeKey: "acme/deevy", baseBranch: "trunk" },
      })
      .where(eq(projectTable.id, seeded.project.id));
  }
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const run = await asPlanner.runs.start({ issue: issue.url });
  return {
    ada,
    planner,
    seeded,
    issue,
    run,
    asAda: createRouterClient(router, { context: { ...ada, sockets } }),
    asPlanner,
  };
}

describe("what a Run is told to clone", () => {
  it("is the repository, the branch to cut, and a credential that expires", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run } = await workspace(db);

    const checkout = await asPlanner.runs.checkout({ runId: run.id });

    expect(checkout).toMatchObject({
      cloneUrl: "/tmp/acme-deevy.git",
      username: "x-access-token",
      token: "stub-token",
      baseBranch: "trunk",
    });
    // The core names the branch so the runtime never has to invent one, and
    // two attempts at one record cannot collide (docs/plans/sockets.md).
    expect(checkout?.headBranch).toMatch(/^deevy\/acme-deevy-42-/);
    expect(checkout?.headBranch).toContain(run.id.slice(4, 12));
  });

  it("puts the credential in no Event, no read and no answer but its own", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run } = await workspace(db);

    await asPlanner.runs.checkout({ runId: run.id });

    // The log says a credential was issued and never what it was (ADR-0014).
    const events = await db.query.event.findMany({});
    expect(events.map((event) => event.kind)).toContain("run.checkout_issued");
    expect(JSON.stringify(events)).not.toContain("stub-token");
    const reads = JSON.stringify([
      await asAda.runs.get({ runId: run.id }),
      await asAda.runs.list({}),
      await asAda.events.list({}),
    ]);
    expect(reads).not.toContain("stub-token");
  });

  it("is refused for another Agent's Run, and is nothing where there is no repository", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, run, seeded } = await workspace(db);
    const { sockets } = fakeSockets();
    const other = await agentContext(db, {
      name: "Builder",
      handle: "builder",
      email: "builder@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const asBuilder = createRouterClient(router, { context: { ...other, sockets } });

    await expect(asBuilder.runs.checkout({ runId: run.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // A Project bound to a tracker and nothing else is ordinary, and the
    // supervisor asks this of every Run it takes up: a refusal here would put
    // a 404 in an operator's log on nothing going wrong (apps/agent/src/work.ts).
    await db
      .update(projectTable)
      .set({ forgeSocketId: null, forgeScope: null })
      .where(eq(projectTable.id, seeded.project.id));
    expect(await asPlanner.runs.checkout({ runId: run.id })).toBeNull();
  });
});

describe("the pull request a Run opens", () => {
  it("says what it closes and which Run did it, and becomes evidence on the record", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, issue, run } = await workspace(db);

    const opened = await asPlanner.pulls.open({
      runId: run.id,
      head: "deevy/acme-deevy-42-abcd1234",
      summary: "Cap the coupon at the basket total",
    });

    expect(opened).toMatchObject({ number: 1 });
    expect(opened.url).toContain("/pull/1");
    // Closing the record is GitHub's own convention, and the Run id is what
    // ties a pull request back to the attempt that produced it.
    const [pull] = await db.query.issueLink.findMany({});
    expect(pull).toMatchObject({ kind: "pull_request", runId: run.id, url: opened.url });

    const events = await db.query.event.findMany({ orderBy: { seq: "asc" } });
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("issue.link_added");
    expect(kinds).toContain("run.pull_request_opened");
    const linked = events.find((event) => event.kind === "issue.link_added");
    expect(linked?.payload).toMatchObject({ runId: run.id });
    expect(issue.url).toBeTruthy();
  });

  it("is one per Run, however many times it is asked for", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run } = await workspace(db);

    // The instructions tell an Agent to open it (apps/agent/src/instructions.md)
    // and the supervisor opens one for any branch a session pushed and did not
    // (apps/agent/src/work.ts). Both happen on the same Run, and a reviewer
    // with two pull requests for one attempt has to work out which is real.
    const first = await asPlanner.pulls.open({ runId: run.id, head: "deevy/acme-deevy-42-abcd" });
    const again = await asPlanner.pulls.open({ runId: run.id, head: "deevy/acme-deevy-42-abcd" });

    expect(again).toMatchObject({ url: first.url, number: first.number });
    expect(await db.query.issueLink.findMany({})).toHaveLength(1);
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "run.pull_request_opened")).toHaveLength(1);
  });

  it("is refused where the Project has no repository", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run } = await workspace(db, { forge: false });

    await expect(
      asPlanner.pulls.open({ runId: run.id, head: "deevy/whatever" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("what a pull request is called, and what it says", () => {
  it("leads with the record's key, and fits in a title", () => {
    expect(titleFor("acme/deevy#42")).toBe("acme/deevy#42: worked by a deevy Agent");
    expect(titleFor("acme/deevy#42", "Cap the coupon\nand a second line")).toBe(
      "acme/deevy#42: Cap the coupon",
    );
    expect(titleFor("acme/deevy#42", "x".repeat(200)).length).toBeLessThanOrEqual(100);
  });

  it("closes the record it is for, and names the Agent and the Run", () => {
    const body = pullBody({
      summary: "Cap the coupon at the basket total",
      issueUrl: "https://github.com/acme/deevy/issues/42",
      runId: "run_abc123def456",
      agentName: "Planner",
    });

    // Signed as a comment on the record is, because the forge shows the App as
    // the author of both (sockets/mirror.ts).
    expect(body).toBe(
      [
        "Cap the coupon at the basket total",
        "",
        "Closes https://github.com/acme/deevy/issues/42",
        "",
        "— Planner · run_abc123def456 · via deevy",
      ].join("\n"),
    );
  });

  it("names a branch after the record and the attempt", () => {
    expect(branchFor("acme/deevy#42", "run_abc123def456")).toBe("deevy/acme-deevy-42-abc123de");
    // A key with nothing a branch can carry still leaves a usable name.
    expect(branchFor("", "run_abc123def456")).toBe("deevy/abc123de");
  });
});

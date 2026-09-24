import { project as projectTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * Where a Project's documents live, and an Agent reading one (ADR-0024).
 *
 * deevy stopped keeping Documents: a team's plans stay in their own tool, and
 * a Project's docs binding says which one. `docs.get` — the `docs_get` tool —
 * reads a page there as markdown, through the same Socket, for an Agent that
 * may see the Project and nobody else's.
 */
async function workspace(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, ada.workspace.id);
  const { sockets } = fakeSockets();
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const builder = await agentContext(db, {
    name: "Builder",
    handle: "builder",
    email: "builder@example.com",
    sponsor: ada.member,
  });
  return {
    seeded,
    asAda: createRouterClient(router, { context: { ...ada, sockets } }),
    asPlanner: createRouterClient(router, { context: { ...planner, sockets } }),
    asBuilder: createRouterClient(router, { context: { ...builder, sockets } }),
  };
}

describe("a Project's documents", () => {
  it("are bound by an admin to a Socket that can read them, and unbound again", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, seeded } = await workspace(db);

    const bound = await asAda.projects.update({
      slug: seeded.project.slug,
      docs: { socketId: seeded.socketId, scope: {} },
    });
    expect(bound).toMatchObject({ docsSocketId: seeded.socketId });

    const unbound = await asAda.projects.update({ slug: seeded.project.slug, docs: null });
    expect(unbound).toMatchObject({ docsSocketId: null, docsScope: null });
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "project.updated")).toHaveLength(2);
  });

  it("are read by an Agent as a page's markdown, by its URL or its id", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, seeded } = await workspace(db);
    await db
      .update(projectTable)
      .set({ docsSocketId: seeded.socketId, docsScope: {} })
      .where(eq(projectTable.id, seeded.project.id));

    const byUrl = await asPlanner.docs.get({
      project: seeded.project.slug,
      page: "https://tracker.test/pages/the-plan",
    });
    const byId = await asPlanner.docs.get({ project: seeded.project.slug, page: "p-1" });

    expect(byUrl).toEqual({
      title: "The plan",
      markdown: "# The plan\n\nRead from https://tracker.test/pages/the-plan.",
      url: "https://tracker.test/pages/the-plan",
    });
    expect(byId.url).toBe("https://tracker.test/pages/p-1");
  });

  it("are nowhere for a Project with no documents bound, and say so", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, seeded } = await workspace(db);

    await expect(
      asPlanner.docs.get({ project: seeded.project.slug, page: "p-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("documents") });
  });

  it("say what the tool said when it will not show a page", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, seeded } = await workspace(db);
    await db
      .update(projectTable)
      .set({ docsSocketId: seeded.socketId, docsScope: {} })
      .where(eq(projectTable.id, seeded.project.id));

    await expect(
      asPlanner.docs.get({ project: seeded.project.slug, page: "missing-page" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("shared") });
  });

  it("are no business of an Agent the Project was not granted to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asBuilder, seeded } = await workspace(db);
    await db
      .update(projectTable)
      .set({ docsSocketId: seeded.socketId, docsScope: {} })
      .where(eq(projectTable.id, seeded.project.id));

    await expect(
      asBuilder.docs.get({ project: seeded.project.slug, page: "p-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

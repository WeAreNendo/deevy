import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { contextFor, memberContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("workspace.update", () => {
  it("renames the Workspace, reslugs it, and records the change", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });

    const renamed = await client.workspace.update({ name: "Acme Team" });

    expect(renamed).toMatchObject({ name: "Acme Team", slug: "acme-team" });
    // A later request builds its context afresh, which is what sees the change.
    const later = createRouterClient(router, {
      context: contextFor(db, admin.member, { ...admin.workspace, ...renamed }),
    });
    expect(await later.workspace.get()).toMatchObject({ name: "Acme Team" });
    const page = await client.events.list({ subjectType: "workspace" });
    expect(page.events.at(-1)).toMatchObject({
      kind: "workspace.updated",
      actorMemberId: admin.member.id,
      payload: { from: "deevy", to: "Acme Team" },
    });
  });

  it("refuses a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    const client = createRouterClient(router, { context: bob });
    await expect(client.workspace.update({ name: "Mine" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

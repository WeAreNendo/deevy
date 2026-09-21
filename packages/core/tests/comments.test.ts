import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { extractHandles } from "../src/mentions.ts";
import { router } from "../src/operations/index.ts";
import { fakeSockets, memberContext, seedProject, testDb, type MemberContext } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Project bound to a tracker Socket and one record projected from it. deevy
 * stores no comments: `comments.create` writes to the tracker and keeps the
 * Event, because a mention is a trigger and the log is the record of what
 * happened (ADR-0024).
 */
async function withIssue(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const client = createRouterClient(router, { context: { ...admin, sockets } });
  const { record } = await seedProject(db, admin.workspace.id);
  const issue = await record({ externalId: "1", title: "Ship it" });
  return { admin, client, issue };
}

describe("extractHandles", () => {
  it("finds @handles and ignores an email address", () => {
    expect(extractHandles("ping @bob and @carol, not bob@example.com")).toEqual(["bob", "carol"]);
    expect(extractHandles("nothing here")).toEqual([]);
    expect(extractHandles("@bob @bob")).toEqual(["bob"]);
  });
});

describe("comments.create", () => {
  it("writes to the tracker under the Socket's account and resolves the Members named", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, issue } = await withIssue(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });

    const comment = await client.comments.create({
      issue: issue.externalKey,
      body: "ping @bob and @carol",
    });

    expect(comment.body).toBe("ping @bob and @carol");
    // The tracker shows the Socket's own account as the author, which is why
    // the body deevy sends carries the Member's signature (ADR-0024).
    expect(comment.author).toMatchObject({ login: "deevy", isBot: true });
    expect(comment.url).toContain(issue.url);

    const page = await client.events.list({ subjectType: "issue" });
    const created = page.events.findLast((e) => e.kind === "comment.created");
    expect(created).toBeDefined();
    expect(created?.actorMemberId).toBe(admin.member.id);
    const mentioned = (created?.payload as { mentionedMemberIds: string[] } | undefined)
      ?.mentionedMemberIds;
    expect(mentioned).toBeDefined();
    expect([...(mentioned ?? [])].sort()).toEqual([bob.member.id, carol.member.id].sort());
  });

  it("mentions nobody when no handle matches", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, issue } = await withIssue(db);

    await client.comments.create({ issue: issue.url, body: "ping @nobody" });

    const page = await client.events.list({ subjectType: "issue" });
    const created = page.events.findLast((e) => e.kind === "comment.created");
    expect(created).toBeDefined();
    expect(
      (created?.payload as { mentionedMemberIds: string[] } | undefined)?.mentionedMemberIds,
    ).toEqual([]);
  });

  it("refuses a record no Socket in this Workspace knows", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withIssue(db);

    await expect(
      client.comments.create({ issue: "acme/deevy#404", body: "anyone there?" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

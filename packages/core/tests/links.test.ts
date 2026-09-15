import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseLink } from "../src/links.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, memberContext, testDb, type MemberContext } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("parseLink", () => {
  it("recognises a GitHub pull request, commit and branch", () => {
    expect(parseLink("https://github.com/WeAreNendo/deevy/pull/12")).toMatchObject({
      kind: "pull_request",
      ref: "12",
    });
    expect(parseLink("https://github.com/WeAreNendo/deevy/commit/abc123def456")).toMatchObject({
      kind: "commit",
      ref: "abc123def456",
    });
    expect(parseLink("https://github.com/WeAreNendo/deevy/tree/feature/live-events")).toMatchObject(
      {
        kind: "branch",
        ref: "feature/live-events",
      },
    );
  });

  it("recognises a GitLab merge request as a pull request", () => {
    expect(parseLink("https://gitlab.com/acme/widgets/-/merge_requests/7")).toMatchObject({
      kind: "pull_request",
      ref: "7",
    });
    expect(parseLink("https://gitlab.com/acme/widgets/-/commit/deadbeef")).toMatchObject({
      kind: "commit",
      ref: "deadbeef",
    });
  });

  it("falls back to a plain url when nothing matches", () => {
    expect(parseLink("https://example.com/design")).toMatchObject({ kind: "url", ref: null });
  });
});

async function withIssue(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const client = createRouterClient(router, { context: admin });
  const project = await client.projects.create({ name: "deevy", key: "DEV" });
  await client.issues.create({ projectKey: "DEV", title: "Ship it" });
  return { admin, client, project };
}

/**
 * An Agent granted the Project, with an open Run on DEV-1 and a Link that Run
 * attached: the evidence one attempt produced (CONTEXT.md).
 */
async function agentWithLink(
  db: MemberContext["db"],
  admin: MemberContext,
  projectId: string,
  options: { name: string; url: string },
) {
  const context = await agentContext(db, {
    sponsor: admin.member,
    name: options.name,
    grants: [projectId],
  });
  const client = createRouterClient(router, { context });
  const run = await client.runs.start({ issueKey: "DEV-1" });
  const link = await client.links.add({ issueKey: "DEV-1", url: options.url, runId: run.id });
  return { context, client, run, link };
}

describe("links.add", () => {
  it("derives the kind from the url", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withIssue(db);

    const link = await client.links.add({
      issueKey: "DEV-1",
      url: "https://github.com/WeAreNendo/deevy/pull/12",
    });

    expect(link).toMatchObject({
      kind: "pull_request",
      ref: "12",
    });
    const page = await client.events.list({ subjectType: "issue" });
    expect(page.events.findLast((e) => e.kind === "issue.link_added")).toBeTruthy();
  });

  it("lets an explicit kind override what was derived", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withIssue(db);

    const link = await client.links.add({
      issueKey: "DEV-1",
      url: "https://example.com/design",
      kind: "branch",
      title: "The design",
    });

    expect(link).toMatchObject({ kind: "branch", title: "The design" });
  });
});

describe("links.remove", () => {
  it("drops the Link and records it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withIssue(db);
    const link = await client.links.add({
      issueKey: "DEV-1",
      url: "https://example.com/design",
    });

    await client.links.remove({ linkId: link.id });

    expect((await client.links.list({ issueKey: "DEV-1" })).links).toEqual([]);
    const page = await client.events.list({ subjectType: "issue" });
    expect(page.events.findLast((e) => e.kind === "issue.link_removed")).toBeTruthy();
  });

  it("refuses an Agent the evidence another Run attached", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, project } = await withIssue(db);
    const planner = await agentWithLink(db, admin, project.id, {
      name: "Planner",
      url: "https://github.com/WeAreNendo/deevy/pull/12",
    });
    const builder = await agentWithLink(db, admin, project.id, {
      name: "Builder",
      url: "https://github.com/WeAreNendo/deevy/pull/13",
    });

    await expect(builder.client.links.remove({ linkId: planner.link.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Still there: an Agent erasing another attempt's evidence would read as
    // housekeeping in the Event log.
    const links = (await planner.client.links.list({ issueKey: "DEV-1" })).links;
    expect(links.map((link) => link.id)).toContain(planner.link.id);
  });

  it("tells an Agent a Link in a Project it was never granted does not exist", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    const link = await client.links.add({ issueKey: "DEV-1", url: "https://example.com/design" });
    // Granted nothing: an ungranted Project does not exist to an Agent rather
    // than being forbidden (docs/plans/m2.md), and that answer comes before
    // anything the Link itself would say.
    const stranger = await agentContext(db, { sponsor: admin.member, name: "Stranger" });

    const asStranger = createRouterClient(router, { context: stranger });
    await expect(asStranger.links.remove({ linkId: link.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No such Project",
    });
  });

  it("lets an Agent take back what its own Run attached", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, project } = await withIssue(db);
    const planner = await agentWithLink(db, admin, project.id, {
      name: "Planner",
      url: "https://github.com/WeAreNendo/deevy/pull/12",
    });

    await planner.client.links.remove({ linkId: planner.link.id });

    expect((await client.links.list({ issueKey: "DEV-1" })).links).toEqual([]);
    const page = await client.events.list({ subjectType: "issue" });
    const removed = page.events.findLast((e) => e.kind === "issue.link_removed");
    expect(removed?.actorMemberId).toBe(planner.context.member.id);
  });
});

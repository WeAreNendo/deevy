import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseLink } from "../src/links.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, memberContext, seedProject, testDb, type MemberContext } from "./helpers.ts";

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

/** A Project bound to a tracker, and one record projected from it (ADR-0024). */
async function withIssue(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const client = createRouterClient(router, { context: admin });
  const { project, record } = await seedProject(db, admin.workspace.id);
  const issue = await record({ externalId: "1", title: "Ship it" });
  return { admin, client, project, issue };
}

/**
 * An Agent granted the Project, with an open Run on the record and a Link that
 * Run attached: the evidence one attempt produced (CONTEXT.md).
 */
async function agentWithLink(
  db: MemberContext["db"],
  admin: MemberContext,
  projectId: string,
  options: { name: string; issue: string; url: string },
) {
  const context = await agentContext(db, {
    sponsor: admin.member,
    name: options.name,
    grants: [projectId],
  });
  const client = createRouterClient(router, { context });
  const run = await client.runs.start({ issue: options.issue });
  const link = await client.links.add({ issue: options.issue, url: options.url, runId: run.id });
  return { context, client, run, link };
}

describe("links.add", () => {
  it("derives the kind from the url", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, issue } = await withIssue(db);

    const link = await client.links.add({
      issue: issue.externalKey,
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
    const { client, issue } = await withIssue(db);

    const link = await client.links.add({
      // By URL, which is the canonical handle a Human pastes (ADR-0024).
      issue: issue.url,
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
    const { client, issue } = await withIssue(db);
    const link = await client.links.add({
      issue: issue.externalKey,
      url: "https://example.com/design",
    });

    await client.links.remove({ linkId: link.id });

    expect((await client.links.list({ issue: issue.externalKey })).links).toEqual([]);
    const page = await client.events.list({ subjectType: "issue" });
    expect(page.events.findLast((e) => e.kind === "issue.link_removed")).toBeTruthy();
  });

  it("refuses an Agent the evidence another Run attached", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, project, issue } = await withIssue(db);
    const planner = await agentWithLink(db, admin, project.id, {
      name: "Planner",
      issue: issue.externalKey,
      url: "https://github.com/WeAreNendo/deevy/pull/12",
    });
    const builder = await agentWithLink(db, admin, project.id, {
      name: "Builder",
      issue: issue.externalKey,
      url: "https://github.com/WeAreNendo/deevy/pull/13",
    });

    await expect(builder.client.links.remove({ linkId: planner.link.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Still there: an Agent erasing another attempt's evidence would read as
    // housekeeping in the Event log.
    const links = (await planner.client.links.list({ issue: issue.externalKey })).links;
    expect(links.map((link) => link.id)).toContain(planner.link.id);
  });

  it("tells an Agent a Link in a Project it was never granted does not exist", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, issue } = await withIssue(db);
    const link = await client.links.add({
      issue: issue.externalKey,
      url: "https://example.com/design",
    });
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
    const { admin, client, project, issue } = await withIssue(db);
    const planner = await agentWithLink(db, admin, project.id, {
      name: "Planner",
      issue: issue.externalKey,
      url: "https://github.com/WeAreNendo/deevy/pull/12",
    });

    await planner.client.links.remove({ linkId: planner.link.id });

    expect((await client.links.list({ issue: issue.externalKey })).links).toEqual([]);
    const page = await client.events.list({ subjectType: "issue" });
    const removed = page.events.findLast((e) => e.kind === "issue.link_removed");
    expect(removed?.actorMemberId).toBe(planner.context.member.id);
  });
});

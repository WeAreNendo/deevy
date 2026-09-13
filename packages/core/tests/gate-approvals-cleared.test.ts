import { loadMarkdown } from "@deevy/editor";
import { createRouterClient } from "@orpc/server";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openRoom, storeRoom } from "../src/room-store.ts";
import { authorizeRoom } from "../src/rooms.ts";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb, type MemberContext } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Gate that wants two Humans, on an Issue whose intent one of them has
 * already approved. The question this file answers: what happens to that
 * approval when the intent changes before the second Human sees it
 * (docs/plans/collaborative-documents.md, ADR-0021).
 */
async function gateWantingTwo(db: MemberContext["db"]) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const grace = await memberContext(db, { name: "Grace" });
  const client = createRouterClient(router, { context: ada });
  const project = await client.projects.create({ name: "deevy", key: "DEV" });
  const intent = project.states.find((one) => one.name === "Intent")!;
  await client.workflow.update({
    projectKey: "DEV",
    states: project.states.map((one) =>
      one.id === intent.id ? { ...one, approvalsRequired: 2 } : one,
    ),
  });
  await client.issues.create({ projectKey: "DEV", title: "Ship it" });
  await client.documents.write({ issueKey: "DEV-1", name: "intent", body: "What Ada approved." });
  await client.gates.approve({ key: "DEV-1", note: "Looks right" });
  return { ada, grace, client };
}

/** Somebody typing in the room, and the quiet that writes it down. */
async function typeInto(context: MemberContext, markdown: string) {
  const room = await authorizeRoom(context, "document:DEV-1:intent");
  const doc = new Y.Doc();
  await openRoom({ db: context.db, room, doc });
  loadMarkdown(doc, markdown);
  await storeRoom({
    db: context.db,
    room,
    doc,
    authors: [context.member.id],
    now: new Date(),
    log: { workspace: { id: context.workspace.id } },
  });
}

describe("a Document that changes under an open Gate", () => {
  it("clears the approvals already given, so nobody approves words they never saw", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await gateWantingTwo(db);

    const before = await client.issues.get({ key: "DEV-1" });
    expect(before.gate?.approvals).toHaveLength(1);

    await typeInto(
      await memberContext(db, { name: "Planner's Human" }),
      "Something else entirely.",
    );

    const after = await client.issues.get({ key: "DEV-1" });
    expect(after.gate?.approvals).toHaveLength(0);
    // The ruling itself is not deleted: the log keeps what happened, and the
    // count is what changes.
    expect(after.gateDecisions).toHaveLength(1);
  });

  it("says so in the log, with the Document that changed", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await gateWantingTwo(db);
    const issue = await client.issues.get({ key: "DEV-1" });

    await typeInto(await memberContext(db, { name: "Somebody" }), "Different words.");

    const page = await client.events.list({ subjectType: "issue", subjectId: issue.id });
    expect(page.events.findLast((one) => one.kind === "gate.approvals_cleared")).toMatchObject({
      payload: { state: "Intent", name: "intent", cleared: 1 },
    });
  });

  it("leaves a Gate that wanted only one Human alone, because it is already through", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: ada });
    await client.projects.create({ name: "deevy", key: "DEV" });
    await client.issues.create({ projectKey: "DEV", title: "Ship it" });
    await client.documents.write({ issueKey: "DEV-1", name: "intent", body: "Approved once." });
    await client.gates.approve({ key: "DEV-1" });

    // One approval was the whole threshold: the Issue has left the Gate, and
    // editing the intent afterwards is ordinary work rather than a withdrawal.
    await typeInto(ada, "Edited after it went through.");

    const after = await client.issues.get({ key: "DEV-1" });
    expect(after.state.name).toBe("Spec");
    const page = await client.events.list({ subjectType: "issue", subjectId: after.id });
    expect(page.events.some((one) => one.kind === "gate.approvals_cleared")).toBe(false);
  });
});

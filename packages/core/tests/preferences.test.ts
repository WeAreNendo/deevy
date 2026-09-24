import { humanNotificationKinds } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function workspace() {
  const { db, close } = testDb();
  closers.push(close);
  const alice = await memberContext(db, { role: "admin", name: "Alice" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  return {
    db,
    bob,
    asAlice: createRouterClient(router, { context: alice }),
    asBob: createRouterClient(router, { context: bob }),
  };
}

describe("what one Human wants to hear about, and where", () => {
  it("starts as everything in both places, without a row having to exist", async () => {
    const { asBob } = await workspace();

    const { preferences } = await asBob.preferences.get({});

    // One row per kind a Human is sent, whatever that list has grown to: the
    // point is that every kind is offered and defaults to on, not that there
    // are five of them.
    expect(preferences).toHaveLength(humanNotificationKinds.length);
    expect(preferences).toContainEqual({
      kind: "gate_awaiting",
      inbox: true,
      slack: true,
      slackDm: true,
    });
    expect(preferences.every((row) => row.inbox && row.slack)).toBe(true);
  });

  it("is remembered once they say otherwise", async () => {
    const { asBob } = await workspace();

    await asBob.preferences.set({
      preferences: [{ kind: "gate_awaiting", inbox: true, slack: false }],
    });

    const { preferences } = await asBob.preferences.get({});
    expect(preferences).toContainEqual({
      kind: "gate_awaiting",
      inbox: true,
      slack: false,
      slackDm: true,
    });
    // The kinds they said nothing about are untouched.
    expect(preferences).toContainEqual({
      kind: "mention",
      inbox: true,
      slack: true,
      slackDm: true,
    });
  });

  it("is their own and nobody else's", async () => {
    const { asAlice, asBob, bob, db } = await workspace();

    await asBob.preferences.set({
      preferences: [{ kind: "mention", inbox: false, slack: false }],
    });

    const alice = await asAlice.preferences.get({});
    expect(alice.preferences).toContainEqual({
      kind: "mention",
      inbox: true,
      slack: true,
      slackDm: true,
    });
    // Every row written belongs to the Member that asked for it: the operation
    // takes no Member, so there is no way to set another Human's.
    const rows = await db.query.notificationPreference.findMany();
    expect(rows.every((row) => row.memberId === bob.member.id)).toBe(true);
  });
});

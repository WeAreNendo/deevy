import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb, seedProject } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const webhookUrl = "https://hooks.slack.example/services/T000/B000/xxx";

async function workspace() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Alice" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  const asAdmin = createRouterClient(router, { context: admin });
  const { project } = await seedProject(db, admin.workspace.id);
  const channel = await asAdmin.channels.create({ name: "#deevy", webhookUrl });
  return { db, asAdmin, asBob: createRouterClient(router, { context: bob }), project, channel };
}

describe("the Workspace's routing rules", () => {
  it("are set as a whole, read back, and recorded in one Event", async () => {
    const { db, asAdmin, channel, project } = await workspace();

    const set = await asAdmin.routing.set({
      rules: [
        { notificationKind: "gate_awaiting", projectId: null, channelId: channel.id },
        { notificationKind: null, projectId: project.id, channelId: channel.id },
      ],
    });

    expect(set.rules).toHaveLength(2);
    const { rules } = await asAdmin.routing.list({});
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ notificationKind: "gate_awaiting", channelId: channel.id });
    const events = await db.query.event.findMany({ where: { kind: "routing.updated" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ rules: 2 });
  });

  it("replace what was there, so a rule taken out of the list is gone", async () => {
    const { asAdmin, channel } = await workspace();
    await asAdmin.routing.set({
      rules: [
        { notificationKind: "gate_awaiting", projectId: null, channelId: channel.id },
        { notificationKind: "run_finished", projectId: null, channelId: channel.id },
      ],
    });

    await asAdmin.routing.set({
      rules: [{ notificationKind: "run_finished", projectId: null, channelId: channel.id }],
    });

    const { rules } = await asAdmin.routing.list({});
    expect(rules.map((rule) => rule.notificationKind)).toEqual(["run_finished"]);
  });

  it("cannot point at a Channel this Workspace does not have", async () => {
    const { asAdmin } = await workspace();

    await expect(
      asAdmin.routing.set({
        rules: [{ notificationKind: null, projectId: null, channelId: "made-up" }],
      }),
    ).rejects.toThrow(/No such Channel/);
  });

  it("are an admin's to set, and nobody else's", async () => {
    const { asBob, channel } = await workspace();

    await expect(
      asBob.routing.set({
        rules: [{ notificationKind: null, projectId: null, channelId: channel.id }],
      }),
    ).rejects.toThrow(/admin of this Workspace/);
  });
});

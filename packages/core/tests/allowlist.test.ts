import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb } from "./helpers.ts";
import { newId } from "../src/ids.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("allowlist.add", () => {
  it("records a rule and the Event that created it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });

    const rule = await client.allowlist.add({ kind: "email_domain", value: "Example.COM" });

    expect(rule).toMatchObject({
      kind: "email_domain",
      value: "example.com",
      createdBy: admin.member.id,
    });
    expect((await client.allowlist.list({})).rules).toMatchObject([{ value: "example.com" }]);
    const page = await client.events.list({ subjectType: "allowlist_rule", subjectId: rule.id });
    expect(page.events).toMatchObject([
      {
        kind: "allowlist.rule_added",
        actorMemberId: admin.member.id,
        payload: { kind: "email_domain", value: "example.com" },
      },
    ]);
  });

  it("refuses an organisation or a group, which no sign-in proves any more", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });

    for (const kind of ["github_org", "gitlab_group"]) {
      await expect(
        client.allowlist.add({ kind: kind as "email_domain", value: "acme" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      client.allowlist.add({ kind: "email_domain", value: "acme/platform" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await client.allowlist.list({})).rules).toEqual([]);
  });

  it("reports a rule that already exists as a conflict", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });
    await client.allowlist.add({ kind: "email_domain", value: "example.com" });

    await expect(
      client.allowlist.add({ kind: "email_domain", value: "example.com" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    const client = createRouterClient(router, { context: bob });
    await expect(
      client.allowlist.add({ kind: "email_domain", value: "example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a value that is not a domain", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });

    await expect(
      client.allowlist.add({ kind: "email_domain", value: "not a domain" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("allowlist.remove", () => {
  it("drops the rule and records the Event", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });
    const rule = await client.allowlist.add({ kind: "email_domain", value: "example.com" });

    await client.allowlist.remove({ ruleId: rule.id });

    expect((await client.allowlist.list({})).rules).toEqual([]);
    const page = await client.events.list({ subjectType: "allowlist_rule", subjectId: rule.id });
    expect(page.events.map((e) => e.kind)).toEqual([
      "allowlist.rule_added",
      "allowlist.rule_removed",
    ]);
  });

  it("reports an unknown rule as not found", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });

    const client = createRouterClient(router, { context: admin });
    await expect(client.allowlist.remove({ ruleId: newId("allowlistRule") })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });
});

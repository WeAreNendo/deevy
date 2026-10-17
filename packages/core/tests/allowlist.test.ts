import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb } from "./helpers.ts";
import { newId } from "../src/ids.ts";

/**
 * A deployment that signs in with both forges, so a rule of either kind is one
 * that can admit somebody. What `createApp` hands every operation is the list
 * `health.ping` reports (app.ts).
 */
const bothForges = {
  signInProviders: [
    { id: "github", label: "GitHub", kind: "social" as const },
    { id: "gitlab", label: "GitLab", kind: "social" as const },
  ],
};

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

  /**
   * A GitHub login is one label and can never contain a dot, so a rule shaped
   * like an email domain is a rule that can never match. It was accepted
   * because this kind was handed the domain's shape (docs/plans/sign-in.md).
   */
  it("refuses a value shaped like another kind's", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: { ...admin, ...bothForges } });

    await expect(
      client.allowlist.add({ kind: "github_org", value: "example.com" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.allowlist.add({ kind: "email_domain", value: "acme/platform" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The shapes each kind does take, unchanged.
    expect(await client.allowlist.add({ kind: "github_org", value: "acme-labs" })).toMatchObject({
      value: "acme-labs",
    });
    expect(
      await client.allowlist.add({ kind: "gitlab_group", value: "acme/platform" }),
    ).toMatchObject({ value: "acme/platform" });
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

  it("rejects a value that is not a domain or an organization login", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: admin });

    await expect(
      client.allowlist.add({ kind: "email_domain", value: "not a domain" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  /**
   * The shape a value may take is its kind's (docs/plans/sign-in.md slice 5):
   * a GitLab group is a path, which is not a domain and never was one.
   */
  it("takes a group path for a GitLab group and refuses it for an email domain", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: { ...admin, ...bothForges } });

    const rule = await client.allowlist.add({ kind: "gitlab_group", value: "Acme/Platform" });
    expect(rule).toMatchObject({ kind: "gitlab_group", value: "acme/platform" });

    await expect(
      client.allowlist.add({ kind: "email_domain", value: "acme/platform" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  /**
   * A GitHub organization rule asks the sign-in's GitHub account which
   * organizations it is in, and a GitLab group rule its GitLab account
   * (auth.ts, `joinPorts`). Where nobody signs in with that provider — deevy
   * Cloud has no GitLab sign-in — the rule could only ever admit nobody, so it
   * is refused with a reason rather than saved as one that looks like it works.
   */
  it("refuses a rule for a sign-in this deployment does not offer", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const withoutGitLab = createRouterClient(router, {
      context: {
        ...admin,
        signInProviders: [
          { id: "github", label: "GitHub", kind: "social" as const },
          { id: "google", label: "Google", kind: "social" as const },
        ],
      },
    });

    await expect(
      withoutGitLab.allowlist.add({ kind: "gitlab_group", value: "acme/platform" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/sign in here with GitLab/) as unknown as string,
    });
    expect(await withoutGitLab.allowlist.add({ kind: "github_org", value: "acme" })).toMatchObject({
      kind: "github_org",
    });

    // An instance that offers no sign-in at all takes only the rule that is
    // about the address.
    const withNone = createRouterClient(router, { context: admin });
    await expect(
      withNone.allowlist.add({ kind: "github_org", value: "acme-labs" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/sign in here with GitHub/) as unknown as string,
    });
    expect(
      await withNone.allowlist.add({ kind: "email_domain", value: "example.com" }),
    ).toMatchObject({ kind: "email_domain" });

    // Nothing was saved for the two it refused, and no Event says otherwise.
    expect((await withNone.allowlist.list({})).rules.map((rule) => rule.value)).toEqual([
      "acme",
      "example.com",
    ]);
    const page = await withNone.events.list({ subjectType: "allowlist_rule" });
    expect(page.events).toHaveLength(2);
  });
});

describe("allowlist.remove", () => {
  it("drops the rule and records the Event", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const client = createRouterClient(router, { context: { ...admin, ...bothForges } });
    const rule = await client.allowlist.add({ kind: "github_org", value: "acme" });

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

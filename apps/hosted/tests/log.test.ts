import { createDurableDb, migrateDurable } from "@deevy/adapters/durable";
import { createNodeDurableStorage } from "@deevy/adapters/testing";
import { createApp, createAuth } from "@deevy/core";
import { allowlistRule, user } from "@deevy/db";
import { migrations } from "@deevy/db/durable-migrations";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { betterAuthLogger, reportFor, throwDescribed } from "../src/log.ts";

// Signing in goes through the OAuth stub, which answers GitHub for the whole
// file; nothing else here reaches for the network.
await import("../../web/scripts/stub-oauth.js");

/**
 * What a hosted Workspace writes to deevy Cloud's logs, which promise nothing
 * from its database (apps/docs/content/cloud/support.md). The failure is a real
 * one, on the driver a Workspace runs — drizzle's durable-sqlite, on a Durable
 * Object's storage played by node:sqlite — so what is checked is what the
 * object's reporter would be handed. A Node test, beside artifact.test.ts.
 */
const grace = {
  id: "usr_gracerecog1",
  name: "Grace Recognisable",
  email: "grace.recognisable@example.com",
};
const values = [grace.id, grace.name, grace.email, "grace.again@example.com"];

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.restoreAllMocks();
});

function migratedDb() {
  const storage = createNodeDurableStorage();
  closers.push(storage.close);
  const db = createDurableDb(storage);
  const migrated = migrateDurable(db, migrations);
  if (migrated.error) throw new Error(migrated.error.message);
  return db;
}

async function failedWrite(): Promise<DrizzleQueryError> {
  const db = migratedDb();
  await db.insert(user).values(grace);
  const failure = await db
    .insert(user)
    .values({ ...grace, email: "grace.again@example.com" })
    .then(() => null)
    .catch((error: unknown) => error);
  if (!(failure instanceof DrizzleQueryError)) throw new Error("the second write did not fail");
  return failure;
}

/** Everything the console was handed, as one string. */
function written(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.flat().map(String).join("\n");
}

describe("a hosted Workspace's log", () => {
  it("names the Workspace, the failed query and SQLite's reason, and none of the row", async () => {
    const failure = await failedWrite();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    reportFor("acme")(failure);

    const line = written(logged);
    expect(line).toMatch(/^\[acme\] DrizzleQueryError: insert into "user"/);
    expect(line).toContain("UNIQUE constraint failed: user.id");
    for (const value of values) expect(line).not.toContain(value);
  });

  it("holds Better Auth's own lines to the same rule", async () => {
    const failure = await failedWrite();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = betterAuthLogger("acme");

    // The two ways Better Auth 1.7.3 logs a failed query: the error as an
    // argument (oauth2/link-account.mjs), and, when its message mentions a
    // column or a table, the message as the line itself (api/index.mjs).
    logger.log?.("error", "Unable to create OAuth user", failure, { email: grace.email });
    logger.log?.("error", failure.message);

    const line = written(logged);
    expect(line).toContain("[acme] [Better Auth] Unable to create OAuth user");
    expect(line).toContain('[acme] [Better Auth] Failed query: insert into "user"');
    expect(line).toContain("UNIQUE constraint failed: user.id");
    for (const value of values) expect(line).not.toContain(value);
  });

  it("hands the platform an error that carries only its description", async () => {
    const failure = await failedWrite();
    const thrown = (() => {
      try {
        throwDescribed(failure);
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/^DrizzleQueryError: insert into "user"/);
    for (const value of values) expect(message).not.toContain(value);
  });
});

/**
 * A Workspace as its object builds one (src/workspace.ts), but for what a
 * sign-in never touches: deevy on the durable driver under `/acme`, its Better
 * Auth with the hosted logger, and the app with the hosted reporter.
 */
async function hostedWorkspace(rethrowUnexpected = true) {
  const db = migratedDb();
  const baseURL = "https://app.example.com/acme";
  const auth = createAuth({
    db,
    env: {
      baseURL,
      secret: "a-workspace-secret-of-at-least-32-characters",
      trustedOrigins: ["https://app.example.com"],
      providers: { github: { clientId: "stub-client", clientSecret: "stub-secret" } },
      adminEmail: "ada@example.com",
    },
    logger: betterAuthLogger("acme"),
    rethrowUnexpected,
  });
  await auth.$context;
  const app = createApp({
    db,
    auth,
    origin: ["https://app.example.com"],
    baseURL,
    onError: reportFor("acme"),
  });
  return { db, app };
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

type Requests = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/** One Human through the stub's dance, as apps/server's tests/hosted-workspace.ts does it. */
async function signIn(app: Requests, email: string): Promise<Response> {
  const started = await app.request("/acme/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/acme/" }),
  });
  const { url } = (await started.json()) as { url?: string };
  const state = url ? (new URL(url).searchParams.get("state") ?? "") : "";
  return app.request(
    `/acme/api/auth/callback/github?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(started) }, redirect: "manual" },
  );
}

describe("a sign-in that fails on the database", () => {
  /**
   * deevy's own hook on a new session (`admit`, packages/core/src/auth.ts)
   * writes inside Better Auth's callback, where nothing of Better Auth's wraps
   * it, so a failure there reached better-call's own `# SERVER_ERROR` line,
   * which logged it whole: the update below, and Grace's address bound to it.
   * Grace signs in once before any rule lets her in, then again after one
   * does, and the write that spends her invitations fails.
   */
  it("says nothing of the Human it was signing in", async () => {
    const { db, app } = await hostedWorkspace();
    expect((await signIn(app, "ada@example.com")).status).toBe(302);
    expect((await signIn(app, grace.email)).status).toBe(302);
    const workspace = await db.query.workspace.findFirst();
    await db.insert(allowlistRule).values({
      id: "allow_example0001",
      workspaceId: workspace?.id ?? "",
      kind: "email_domain",
      value: "example.com",
    });
    await db.run(sql`ALTER TABLE "invitation" RENAME TO "invitation_gone"`);

    const logged = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    const answered = await signIn(app, grace.email);

    // The browser is told a 500, as it was; the body is now the app's words
    // for one rather than better-call's empty one.
    expect(answered.status).toBe(500);
    expect(await answered.text()).toBe("Internal Server Error");
    const lines = logged.map(written).join("\n");
    expect(lines).toContain('[acme] DrizzleQueryError: update "invitation"');
    expect(lines).toContain("no such table: invitation");
    expect(lines).not.toContain("SERVER_ERROR");
    expect(lines).not.toContain(grace.email);
  });

  /**
   * Handing an unexpected error back changes nothing about a refusal Better
   * Auth chose: what the SPA and an OAuth client are answered is the same
   * either way. A failure it did not choose is a 500 either way, and is no
   * longer logged whole: where the sign-in's state is kept being gone, the
   * line better-call wrote carried the state and its PKCE verifier.
   */
  it("answers a refusal Better Auth chose exactly as it did", async () => {
    const answers = async (rethrow: boolean) => {
      const { db, app } = await hostedWorkspace(rethrow);
      const start = (provider?: string) =>
        app.request("/acme/api/auth/sign-in/social", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, callbackURL: "/acme/" }),
        });
      const said = async (response: Response | Promise<Response>) => {
        const answered = await response;
        return {
          status: answered.status,
          location: answered.headers.get("location"),
          body: await answered.text(),
        };
      };
      const refusals = [
        await said(start("nowhere")),
        await said(start()),
        await said(
          app.request("/acme/api/auth/callback/github?state=never-issued&code=ada%40example.com", {
            redirect: "manual",
          }),
        ),
      ];
      await db.run(sql`ALTER TABLE "verification" RENAME TO "verification_gone"`);
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = await said(start("github"));
      const lines = written(logged);
      logged.mockRestore();
      return { refusals, broken, lines };
    };

    const before = await answers(false);
    const after = await answers(true);
    expect(after.refusals).toEqual(before.refusals);
    expect(after.refusals.map(({ status }) => status)).toEqual([404, 400, 302]);
    expect(before.broken).toEqual({ status: 500, location: null, body: "" });
    expect(after.broken).toEqual({ status: 500, location: null, body: "Internal Server Error" });
    expect(before.lines).toContain("codeVerifier");
    expect(after.lines).toMatch(/^\[acme\] DrizzleQueryError: insert into "verification"/);
    expect(after.lines).not.toContain("codeVerifier");
    expect(after.lines).not.toContain("SERVER_ERROR");
  });
});

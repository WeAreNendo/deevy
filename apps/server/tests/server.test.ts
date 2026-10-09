import { fetchClientMetadataResource as shapeCheckTransport } from "@deevy/core/cimd";
import { pagePolicy, signInProviders } from "@deevy/core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readEnv } from "../src/env.ts";
import { fetchClientMetadataResource as strictTransport } from "../src/cimd.ts";
import { buildServer } from "../src/server.ts";

const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;

function testEnv() {
  return {
    ...readEnv({}),
    databasePath: ":memory:",
    migrationsFolder,
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
  };
}

function testServer() {
  return buildServer(testEnv());
}

describe("server", () => {
  it("answers the health check", async () => {
    const { app, close } = testServer();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    close();
  });

  it("serves the OpenAPI document", async () => {
    const { app, close } = testServer();
    const res = await app.request("/api/spec.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(Object.keys(spec.paths)).toContain("/health/ping");
    close();
  });

  it("exposes Better Auth", async () => {
    const { app, close } = testServer();
    const res = await app.request("/api/auth/get-session");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    close();
  });

  /**
   * The SPA is mounted after `createApp`, and its pages carry the policy all
   * the same: the headers middleware is registered on every path before it
   * (packages/core/src/headers.ts). A Gate's page is a client-side route, so
   * it is the fallback `index.html` that must refuse to be framed.
   */
  it("serves the SPA with deevy's policy, a Gate's page and the bundle alike", async () => {
    const webDist = mkdtempSync(join(tmpdir(), "deevy-web-"));
    mkdirSync(join(webDist, "assets"));
    writeFileSync(join(webDist, "index.html"), "<!doctype html><div id=root></div>");
    writeFileSync(join(webDist, "assets", "index.js"), "export {};");
    writeFileSync(join(webDist, "_headers"), "/*\n  X-Frame-Options: DENY\n");
    const { app, close } = buildServer({ ...testEnv(), webDist });

    const gate = await app.request("/gates/gate_abc123def456");
    expect(gate.status).toBe(200);
    expect(gate.headers.get("content-type")).toContain("text/html");
    expect(gate.headers.get("content-security-policy")).toBe(pagePolicy);
    expect(gate.headers.get("x-frame-options")).toBe("DENY");
    const index = await app.request("/");
    expect(index.headers.get("content-security-policy")).toBe(pagePolicy);
    const bundle = await app.request("/assets/index.js");
    expect(bundle.headers.get("x-content-type-options")).toBe("nosniff");
    // The Worker's configuration rides in the build; Node sets the headers
    // itself and serves the file to nobody.
    expect((await app.request("/_headers")).status).toBe(404);
    close();
    rmSync(webDist, { recursive: true, force: true });
  });

  /**
   * Node is the target where the DNS-rebinding gap actually closes, and the
   * only thing that closes it is the transport this entry passes. Asserted by
   * identity, and on what `buildServer` handed Better Auth rather than on what
   * the helper returns, so a refactor that inlines the object at the call site
   * and loses the transport with it cannot leave Node quietly on the weaker,
   * shape-checking one the Worker has to live with (docs/plans/m3.md slice 8).
   */
  it("dereferences a client metadata document through the pinning transport", () => {
    const { authEnv, close } = testServer();

    expect(authEnv.fetchClientMetadataResource).toBe(strictTransport);
    expect(authEnv.fetchClientMetadataResource).not.toBe(shapeCheckTransport);
    close();
  });
});

describe("the runner's environment", () => {
  it("defaults the stale window to thirty minutes and the sweep to every minute", () => {
    const env = readEnv({});
    expect(env.runStaleMinutes).toBe(30);
    expect(env.sweepIntervalSeconds).toBe(60);
  });

  it("takes both from the environment", () => {
    const env = readEnv({ DEEVY_RUN_STALE_MINUTES: "5", DEEVY_SWEEP_INTERVAL_SECONDS: "10" });
    expect(env.runStaleMinutes).toBe(5);
    expect(env.sweepIntervalSeconds).toBe(10);
  });
});

describe("the development OAuth stub", () => {
  it("is off unless asked for, and reported as such", async () => {
    expect(readEnv({}).devStubOAuth).toBe(false);
    const { app, close } = testServer();
    const body = (await (await app.request("/api/health/ping")).json()) as { devSignIn: boolean };
    expect(body.devSignIn).toBe(false);
    close();
  });

  /**
   * The documented no-OAuth-App loop starts from a copied `.env.example`, whose
   * client pairs are empty — and a provider is registered only when both halves
   * are set, so without this the stubbed instance offers no way in at all
   * (docs/plans/sign-in.md).
   */
  it("supplies the client pair a developer without an OAuth App does not have", () => {
    const stubbed = readEnv({
      DEEVY_DEV_STUB_OAUTH: "1",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
    });
    expect(stubbed.providers.github).toMatchObject({
      clientId: expect.stringMatching(/.+/) as unknown as string,
      clientSecret: expect.stringMatching(/.+/) as unknown as string,
    });
    // A real pair always wins, so an instance that has one keeps it.
    expect(
      readEnv({
        DEEVY_DEV_STUB_OAUTH: "1",
        GITHUB_CLIENT_ID: "real",
        GITHUB_CLIENT_SECRET: "pair",
      }).providers.github,
    ).toMatchObject({ clientId: "real", clientSecret: "pair" });
    // And without the flag an unset pair stays unset, so the page says so.
    expect(readEnv({}).providers.github).toMatchObject({ clientId: "", clientSecret: "" });
  });

  it("is on for DEEVY_DEV_STUB_OAUTH=1, and health.ping says so", async () => {
    const env = readEnv({ DEEVY_DEV_STUB_OAUTH: "1" });
    expect(env.devStubOAuth).toBe(true);
    const { app, close } = buildServer({
      ...env,
      // Without the stubbed OIDC entry: registering one reads a discovery
      // document over `fetch`, and the stub that answers it replaces `fetch`
      // for a whole process, so it lives in `stub-oauth.test.ts` — which is
      // where a stubbed instance is signed in to.
      providers: { ...env.providers, oidc: undefined },
      databasePath: ":memory:",
      migrationsFolder,
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-1234",
    });
    const body = (await (await app.request("/api/health/ping")).json()) as { devSignIn: boolean };
    expect(body.devSignIn).toBe(true);
    close();
  });

  /**
   * The flag's promise is a dev loop with no account anywhere, and
   * `.env.example` ships every client pair empty — so the stub supplies the
   * pairs as well as the endpoints. Without that a stubbed instance offers no
   * button at all (half a pair is not a provider), the sign-in page says the
   * deployment has none configured, and the development form's sign-in answers
   * `PROVIDER_NOT_FOUND` (docs/DEVELOPMENT.md, "Running without an OAuth App").
   */
  it("stands in for every provider the environment configured none of", () => {
    expect(signInProviders(readEnv({ DEEVY_DEV_STUB_OAUTH: "1" })).map(({ id }) => id)).toEqual([
      "github",
      "google",
      "microsoft",
      "gitlab",
      "linear",
      "slack",
      "atlassian",
      "oidc",
    ]);
    // Without the flag the same environment is what it always was: nothing.
    expect(signInProviders(readEnv({}))).toEqual([]);
  });

  it("reads the new providers' pairs, Microsoft's tenant, and the operator's order", () => {
    const env = readEnv({
      MICROSOFT_CLIENT_ID: "ms",
      MICROSOFT_CLIENT_SECRET: "ms-secret",
      MICROSOFT_TENANT_ID: "organizations",
      LINEAR_CLIENT_ID: "lin",
      LINEAR_CLIENT_SECRET: "lin-secret",
      SLACK_CLIENT_ID: "sl",
      SLACK_CLIENT_SECRET: "sl-secret",
      ATLASSIAN_CLIENT_ID: "atl",
      ATLASSIAN_CLIENT_SECRET: "atl-secret",
      GITHUB_CLIENT_ID: "gh",
      GITHUB_CLIENT_SECRET: "gh-secret",
      DEEVY_SIGN_IN_ORDER: "slack, microsoft",
    });

    expect(env.providers.microsoft).toEqual({
      clientId: "ms",
      clientSecret: "ms-secret",
      tenantId: "organizations",
    });
    expect(signInProviders(env).map(({ id }) => id)).toEqual([
      "slack",
      "microsoft",
      "github",
      "linear",
      "atlassian",
    ]);
  });

  it("leaves a pair the environment did set alone", () => {
    const env = readEnv({
      DEEVY_DEV_STUB_OAUTH: "1",
      GITHUB_CLIENT_ID: "real-client",
      GITHUB_CLIENT_SECRET: "real-secret",
    });
    expect(env.providers.github).toEqual({
      clientId: "real-client",
      clientSecret: "real-secret",
    });
    // And the gaps beside it are still the stub's, so every provider answers.
    expect(signInProviders(env).map(({ id }) => id)).toContain("google");
  });

  it("is refused in production rather than ignored", () => {
    expect(() => readEnv({ DEEVY_DEV_STUB_OAUTH: "1", NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });

  /**
   * The entry imports the very file the acceptance walk and the Workers smoke
   * prepend to their bundles, so there is one stub and one place for it to be
   * wrong. Asserted on the source, because the entry itself listens on a port.
   */
  it("installs the stub the harnesses use, from where they read it", () => {
    const entry = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(entry).toContain('import("../../web/scripts/stub-oauth.js")');
    expect(existsSync(new URL("../../web/scripts/stub-oauth.js", import.meta.url))).toBe(true);
  });
});

/**
 * The provider that is not a tool (ADR-0024).
 *
 * Its own flag rather than the sign-in stub's, because the two are different
 * decisions: a developer with a real GitHub App and no OAuth App wants one, and
 * the acceptance walk wants the other. It is the entry that refuses it in
 * production, because a module that decides where it may run cannot be tested
 * anywhere (packages/sockets/src/index.ts).
 */
describe("the development Socket stub", () => {
  it("is off unless asked for, and health.ping says so", async () => {
    expect(readEnv({}).devStubSockets).toBe(false);
    const { app, close } = testServer();
    const body = (await (await app.request("/api/health/ping")).json()) as {
      devSockets: boolean;
    };
    expect(body.devSockets).toBe(false);
    close();
  });

  it("registers the stub for DEEVY_DEV_STUB_SOCKETS=1, and health.ping says so", async () => {
    const env = readEnv({ DEEVY_DEV_STUB_SOCKETS: "1" });
    expect(env.devStubSockets).toBe(true);
    const { app, close } = buildServer({
      ...env,
      databasePath: ":memory:",
      migrationsFolder,
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-1234",
    });
    const body = (await (await app.request("/api/health/ping")).json()) as { devSockets: boolean };
    expect(body.devSockets).toBe(true);
    close();
  });

  it("is refused in production rather than ignored", () => {
    expect(() => readEnv({ DEEVY_DEV_STUB_SOCKETS: "1", NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });
});

describe("email on the Node server", () => {
  it("reads the sender from the environment, and refuses the stub in production", () => {
    expect(readEnv({}).email).toBeNull();
    expect(
      readEnv({
        DEEVY_EMAIL_SENDER: "resend",
        DEEVY_EMAIL_FROM: "deevy <deevy@example.com>",
        RESEND_API_KEY: "re_not_a_real_key",
      }).email,
    ).toMatchObject({ sender: "resend", credentials: { apiKey: "re_not_a_real_key" } });
    expect(readEnv({ DEEVY_DEV_STUB_EMAIL: "1" }).email?.sender).toBe("stub");
    expect(() => readEnv({ DEEVY_DEV_STUB_EMAIL: "1", NODE_ENV: "production" })).toThrow(
      /DEEVY_DEV_STUB_EMAIL/,
    );
  });

  it("shows what the stub sent at /dev/email, and only when it is the stub", async () => {
    const { clearStubOutbox, createStubSender } = await import("@deevy/email");
    clearStubOutbox();
    await createStubSender().send({
      from: { address: "deevy@example.com" },
      to: "ada@example.com",
      subject: "Gate waiting: acme/deevy#42 · plan",
      text: "Planner is waiting for you at plan",
      html: "<p>Planner is waiting for you at plan</p>",
      headers: {},
    });
    const stubbed = buildServer({
      ...readEnv({ DEEVY_DEV_STUB_EMAIL: "1" }),
      databasePath: ":memory:",
      migrationsFolder,
    });
    const listed = await stubbed.app.request("/dev/email");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([
      { to: "ada@example.com", subject: "Gate waiting: acme/deevy#42 · plan" },
    ]);
    const latest = await stubbed.app.request("/dev/email/0");
    expect(latest.headers.get("content-type")).toMatch(/text\/html/);
    expect(await latest.text()).toContain("Planner is waiting for you at plan");
    stubbed.close();

    const real = testServer();
    expect((await real.app.request("/dev/email")).status).not.toBe(200);
    real.close();
  });

  it("runs SMTP, which only the Node server can speak", async () => {
    const { nodeEmailSenders } = await import("../src/server.ts");
    expect(nodeEmailSenders(false).smtp).toBeTypeOf("function");
    expect(nodeEmailSenders(false).cloudflare).toBeUndefined();
    expect(
      readEnv({
        DEEVY_EMAIL_SENDER: "smtp",
        DEEVY_EMAIL_FROM: "deevy@example.com",
        SMTP_URL: "smtp://mail.example.com:587",
      }).email,
    ).toMatchObject({ sender: "smtp" });
  });
});

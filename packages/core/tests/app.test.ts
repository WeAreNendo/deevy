import { member, user, workspace } from "@deevy/db";
import { ORPCError, call, createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp, isDefinedRefusal } from "../src/app.ts";
import {
  bootstrapWorkspace,
  createAuth,
  signInProviders,
  slugify,
  type AuthProviders,
} from "../src/auth.ts";
import { router } from "../src/operations/index.ts";
import type { AppContext } from "../src/operations/registry.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function anonymous(): AppContext {
  const { db, close } = testDb();
  closers.push(close);
  return { db, session: null, member: null, workspace: null };
}

describe("createApp", () => {
  it("answers /healthz and the RPC ping without auth", async () => {
    const context = anonymous();
    const app = createApp({ db: context.db });
    expect((await app.request("/healthz")).status).toBe(200);

    const res = await app.request("/rpc/health/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: undefined }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: { ok: boolean } };
    expect(body.json.ok).toBe(true);
  });

  it("serves the OpenAPI surface with a spec and a reference page", async () => {
    const context = anonymous();
    const app = createApp({ db: context.db });
    expect((await app.request("/api/health/ping")).status).toBe(200);
    const spec = await app.request("/api/spec.json");
    expect(spec.status).toBe(200);
    const docs = await app.request("/api/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
  });

  it("tells a signed-out SPA whether sign-in is stubbed", async () => {
    const context = anonymous();
    const ping = async (app: ReturnType<typeof createApp>) =>
      (await (await app.request("/api/health/ping")).json()) as { devSignIn: boolean };
    expect((await ping(createApp({ db: context.db }))).devSignIn).toBe(false);
    expect((await ping(createApp({ db: context.db, devSignIn: true }))).devSignIn).toBe(true);
  });

  it("tells a signed-out SPA which providers it offers", async () => {
    const context = anonymous();
    const pair = { clientId: "id", clientSecret: "secret" };
    const providers = async (configured: AuthProviders) => {
      const app = createApp({
        db: context.db,
        signInProviders: signInProviders({ providers: configured }),
      });
      const body = (await (await app.request("/api/health/ping")).json()) as {
        providers: Array<{ id: string; label: string; kind: string }>;
      };
      return body.providers;
    };
    expect(await providers({ github: pair })).toEqual([
      { id: "github", label: "GitHub", kind: "social" },
    ]);
    // Two configured pairs are two buttons, in the order they are offered
    // (docs/plans/sign-in.md slice 4).
    expect(await providers({ github: pair, google: pair })).toEqual([
      { id: "github", label: "GitHub", kind: "social" },
      { id: "google", label: "Google", kind: "social" },
    ]);
    expect(await providers({ google: pair })).toEqual([
      { id: "google", label: "Google", kind: "social" },
    ]);
    // GitLab is one entry whichever instance it points at, so a self-hosted
    // issuer changes where a sign-in goes and not what the page offers
    // (docs/plans/sign-in.md slice 5).
    expect(await providers({ gitlab: { ...pair, issuer: "https://gitlab.example.com" } })).toEqual([
      { id: "gitlab", label: "GitLab", kind: "social" },
    ]);
    // The generic OIDC entry is labelled by the deployment, so an operator
    // names their own IdP without touching the SPA, and falls back to what a
    // teammate who has never heard of it would read (docs/plans/sign-in.md
    // slice 6).
    expect(
      await providers({ oidc: { ...pair, issuer: "https://idp.example", name: "Acme SSO" } }),
    ).toEqual([{ id: "oidc", label: "Acme SSO", kind: "social" }]);
    expect(await providers({ oidc: { ...pair, issuer: "https://idp.example" } })).toEqual([
      { id: "oidc", label: "Single sign-on", kind: "social" },
    ]);
    // An issuer is as load-bearing as the pair: without a discovery document
    // there is nothing to register and nothing a button could start.
    expect(await providers({ oidc: { ...pair, issuer: "" } })).toEqual([]);
    expect(
      await providers({
        oidc: { clientId: "id", clientSecret: "", issuer: "https://idp.example" },
      }),
    ).toEqual([]);
    // Half a pair is not a provider: a button that only leads to the
    // provider's own error page is worse than no button (docs/plans/sign-in.md).
    expect(await providers({ github: { clientId: "", clientSecret: "secret" } })).toEqual([]);
    expect(await providers({ github: { clientId: "id", clientSecret: "" } })).toEqual([]);
    expect(await providers({ google: { clientId: "", clientSecret: "secret" } })).toEqual([]);
    expect(
      await providers({
        gitlab: { clientId: "", clientSecret: "", issuer: "https://git.example" },
      }),
    ).toEqual([]);
  });

  /**
   * The half-a-pair case the sign-in page is meant to be able to report: with
   * `clientId: ""` Better Auth would register GitHub anyway and the failure
   * would arrive as a redirect to GitHub's own error page, so the entry is
   * absent instead and the page offers no button (docs/plans/sign-in.md).
   */
  it("starts a sign-in only with a provider it registered", async () => {
    const baseURL = "https://deevy.example.com";
    const startSignIn = async (github: { clientId: string; clientSecret: string }) => {
      const context = anonymous();
      const auth = createAuth({
        db: context.db,
        env: {
          baseURL,
          secret: "test-secret-that-is-at-least-32-characters",
          providers: { github },
        },
      });
      const app = createApp({ db: context.db, auth, baseURL });
      return app.request(`${baseURL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL: "/" }),
      });
    };
    expect((await startSignIn({ clientId: "id", clientSecret: "secret" })).status).toBe(200);
    expect(
      (await startSignIn({ clientId: "", clientSecret: "secret" })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  /**
   * `genericOAuth` fetches its discovery document while the app is being built
   * and skips the entry when the IdP cannot be reached, logging rather than
   * throwing — so a configured provider is not always a registered one, and
   * only the registered half is a button (docs/plans/sign-in.md).
   */
  it("offers no button for a provider Better Auth could not register", async () => {
    const context = anonymous();
    const baseURL = "https://deevy.example.com";
    const pair = { clientId: "id", clientSecret: "secret" };
    // An issuer in the reserved .example TLD: its discovery document is
    // unreachable whether or not the machine running this has a network.
    const providers: AuthProviders = {
      github: pair,
      oidc: { ...pair, issuer: "https://idp.example" },
    };
    expect(signInProviders({ providers }).map((provider) => provider.id)).toEqual([
      "github",
      "oidc",
    ]);

    const auth = createAuth({
      db: context.db,
      env: { baseURL, secret: "test-secret-that-is-at-least-32-characters", providers },
    });
    const app = createApp({
      db: context.db,
      auth,
      baseURL,
      signInProviders: signInProviders({ providers }),
    });
    const body = (await (await app.request(`${baseURL}/api/health/ping`)).json()) as {
      providers: Array<{ id: string }>;
    };

    expect(body.providers.map((provider) => provider.id)).toEqual(["github"]);
  });

  it("sends a browser that comes back from linking an account while signed out to say so", async () => {
    // The route sits among the OpenAPI surface's paths, and a browser that
    // lands on it must get a page rather than a JSON 404 (account-links.ts).
    const context = anonymous();
    const app = createApp({ db: context.db, baseURL: "https://deevy.test" });

    const answer = await app.request(
      "/api/identities/linear/callback?code=one-use&state=sock_x.1.forged",
    );

    expect(answer.status).toBe(302);
    const location = new URL(answer.headers.get("location") ?? "");
    expect(location.pathname).toBe("/settings/identities");
    expect(location.searchParams.get("linkError")).toMatch(/Sign in to deevy/);
  });

  it("rejects session and member operations for anonymous callers", async () => {
    const context = anonymous();
    const client = createRouterClient(router, { context });
    await expect(client.me.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(call(router.workspace.get, undefined, { context })).rejects.toBeInstanceOf(
      ORPCError,
    );
  });
});

describe("bootstrapWorkspace", () => {
  it("creates the Workspace and the admin Member for the configured email only", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await db.insert(user).values({ id: "u1", name: "Ada", email: "Ada@Example.com" });
    await db.insert(user).values({ id: "u2", name: "Bob", email: "bob@example.com" });

    await bootstrapWorkspace(
      db,
      { userId: "u2", email: "bob@example.com" },
      { adminEmail: "ada@example.com" },
    );
    expect(await db.query.workspace.findFirst()).toBeUndefined();

    await bootstrapWorkspace(
      db,
      { userId: "u1", email: "Ada@Example.com" },
      { adminEmail: "ada@example.com", workspaceName: "Acme Team" },
    );
    const ws = await db.query.workspace.findFirst({ with: { members: true } });
    expect(ws?.slug).toBe("acme-team");
    expect(ws?.members).toHaveLength(1);
    expect(ws?.members[0]).toMatchObject({ userId: "u1", role: "admin", kind: "human" });

    // A second admin sign-in must not create a second Workspace or Member.
    await bootstrapWorkspace(
      db,
      { userId: "u1", email: "ada@example.com" },
      { adminEmail: "ada@example.com" },
    );
    expect(await db.select().from(workspace)).toHaveLength(1);
    expect(await db.select().from(member)).toHaveLength(1);
  });

  it("adds the admin Member when the Workspace already exists without one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
    await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });

    await bootstrapWorkspace(
      db,
      { userId: "u1", email: "ada@example.com" },
      { adminEmail: "ada@example.com" },
    );
    expect(await db.select().from(workspace)).toHaveLength(1);
    expect(await db.query.member.findMany()).toMatchObject([
      { userId: "u1", workspaceId: "w1", role: "admin" },
    ]);
  });

  it("slugifies names", () => {
    expect(slugify("Acme Team!")).toBe("acme-team");
    expect(slugify("   ")).toBe("workspace");
  });
});

describe("what reaches an operator's log", () => {
  it("reports a failure nobody expected, and not a refusal a handler chose", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const reported: unknown[] = [];
    const app = createApp({ db, onError: (error) => reported.push(error) });

    // A caller asking for something that is not there, and one asking without
    // being anybody: both are the operation answering correctly.
    await app.request("/api/runs/nope", { headers: { authorization: "Bearer nope" } });
    await app.request("/api/members");

    expect(reported).toEqual([]);
  });

  it("is not fooled by the class, only by what the caller is told", () => {
    expect(isDefinedRefusal(new ORPCError("NOT_FOUND"))).toBe(true);
    expect(isDefinedRefusal(new ORPCError("FORBIDDEN"))).toBe(true);
    expect(isDefinedRefusal(new ORPCError("CONFLICT"))).toBe(true);
    // deevy raising this on purpose is still something to read about.
    expect(isDefinedRefusal(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(false);
    expect(isDefinedRefusal(new Error("the database went away"))).toBe(false);
  });
});

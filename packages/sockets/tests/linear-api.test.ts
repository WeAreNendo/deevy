import type { TrackerSocket } from "@deevy/core/sockets";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLinearSocket, resetLinearTokens } from "../src/linear/index.ts";

/**
 * What the Linear module asks Linear, and what it makes of the answers.
 *
 * Linear is one GraphQL endpoint, so a fake answers by the operation's name —
 * every query the module sends is named — and records what was asked and with
 * which token. What is proved here is the half a webhook fixture cannot: which
 * credential, which query, and what deevy does when Linear says no.
 */
afterEach(() => {
  resetLinearTokens();
});

const ORG = "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const TEAM = "e4f5a6b7-8c9d-4e0f-a1b2-c3d4e5f6a7b8";
const APP_USER = "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9";
const ISSUE = "0b6e2f4a-3c1d-4e8b-9a7f-5d2c1b0a9e81";
const ref = {
  externalId: ISSUE,
  url: "https://linear.app/acme/issue/ENG-12/checkout-totals-are-wrong-with-a-coupon",
};
const scope = { scopeKey: TEAM, teamKey: "ENG" };

interface Asked {
  url: string;
  authorization: string;
  /** The GraphQL operation's name, or the form's grant type for the token endpoint. */
  operation: string;
  variables: Record<string, unknown>;
  form: Record<string, string>;
}

type Answer = object | ((variables: Record<string, unknown>, asked: Asked) => unknown);

/** A Linear that answers each named operation, and mints a token per client-credentials grant. */
function linearReturning(
  answers: Record<string, Answer>,
  options: {
    tokens?: string[];
    refuse?: (asked: Asked) => boolean;
    /** Linear does not know the client id and secret. */
    unknownClient?: boolean;
    /** The one secret Linear takes for a client id; any, when unsaid. */
    secrets?: Record<string, string>;
  } = {},
) {
  const asked: Asked[] = [];
  const tokens = [...(options.tokens ?? ["lin_oauth_app_token_1", "lin_oauth_app_token_2"])];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : "";
    const isForm = (headers.get("content-type") ?? "").includes("x-www-form-urlencoded");
    const form = isForm ? Object.fromEntries(new URLSearchParams(raw)) : {};
    const json = !isForm && raw ? (JSON.parse(raw) as { query: string; variables?: object }) : null;
    const operation = json
      ? (/(?:query|mutation)\s+(\w+)/.exec(json.query)?.[1] ?? "")
      : (form.grant_type ?? url.split("/").pop() ?? "");
    const one: Asked = {
      url,
      authorization: headers.get("authorization") ?? "",
      operation,
      variables: (json?.variables ?? {}) as Record<string, unknown>,
      form,
    };
    asked.push(one);

    if (url.endsWith("/oauth/token")) {
      // As Linear answered a made-up client on 2026-09-25.
      const known = options.secrets?.[form.client_id ?? ""];
      if (options.unknownClient || (known !== undefined && known !== form.client_secret)) {
        return Response.json(
          { error: "invalid_client", error_description: "Invalid client: client is invalid" },
          { status: 400 },
        );
      }
      if (form.grant_type === "client_credentials") {
        return Response.json({
          access_token: tokens.shift() ?? "lin_oauth_app_token_n",
          token_type: "Bearer",
          expires_in: 2_591_999,
          scope: "read write",
        });
      }
      const answer = answers[`token:${form.grant_type ?? ""}`];
      return answer === undefined
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json(answer);
    }
    if (url.endsWith("/oauth/revoke")) return new Response(null, { status: 200 });
    if (options.refuse?.(one)) {
      // As Linear answered a token it did not know on 2026-09-25.
      return Response.json(
        {
          errors: [
            {
              message: "Authentication required, not authenticated",
              extensions: {
                type: "authentication error",
                code: "AUTHENTICATION_ERROR",
                statusCode: 401,
                userError: true,
                userPresentableMessage: "You need to authenticate to access this operation.",
                meta: {},
                http: { status: 401 },
              },
            },
          ],
        },
        { status: 401 },
      );
    }
    const answer = answers[operation];
    if (answer === undefined) {
      return Response.json(
        { errors: [{ message: `No answer for ${operation}` }] },
        { status: 400 },
      );
    }
    const data = typeof answer === "function" ? answer(one.variables, one) : answer;
    return Response.json({ data });
  }) as typeof fetch;

  /** Another Socket on this same Linear, in this same isolate. */
  const connect = (credentials: { clientId: string; clientSecret: string }) =>
    createLinearSocket({
      config: { organizationId: ORG, urlKey: "acme" },
      credentials,
      fetch: fetchImpl,
      now: () => new Date("2026-09-24T10:00:00Z"),
    });

  const module = connect({ clientId: "lin_client_id_1", clientSecret: "lin_client_secret_1" });
  const { tracker } = module;
  if (!tracker?.listContainers) {
    throw new Error("a Linear Socket is a tracker that offers teams");
  }
  // Checked just above: the binding picker lists the teams the app can see.
  return {
    module,
    tracker: tracker as TrackerSocket & Required<Pick<TrackerSocket, "listContainers">>,
    asked,
    connect,
  };
}

const who = {
  viewer: { id: APP_USER, name: "deevy", displayName: "deevy" },
  organization: { id: ORG, name: "Acme", urlKey: "acme" },
};

describe("how deevy authenticates", () => {
  it("as the app itself: a client-credentials token, minted once and reused", async () => {
    const { module, tracker, asked } = linearReturning({
      DeevyWho: who,
      DeevyTeams: { teams: { nodes: [] } },
    });

    await module.identity();
    await tracker.listContainers();

    const grants = asked.filter((one) => one.operation === "client_credentials");
    expect(grants).toHaveLength(1);
    // The scopes an app actor needs to see the teams and say things on their
    // issues, and nothing that administers the workspace.
    expect(grants[0]?.form).toMatchObject({
      client_id: "lin_client_id_1",
      client_secret: "lin_client_secret_1",
      scope: "read,write",
    });
    const calls = asked.filter((one) => one.url === "https://api.linear.app/graphql");
    expect(calls.map((one) => one.authorization)).toEqual([
      "Bearer lin_oauth_app_token_1",
      "Bearer lin_oauth_app_token_1",
    ]);
  });

  it("mints another when Linear no longer takes the one it has, and asks again once", async () => {
    const { tracker, asked } = linearReturning(
      { DeevyTeams: { teams: { nodes: [] } } },
      { refuse: (one) => one.authorization === "Bearer lin_oauth_app_token_1" },
    );

    await tracker.listContainers();

    expect(asked.filter((one) => one.operation === "client_credentials")).toHaveLength(2);
    expect(asked.at(-1)?.authorization).toBe("Bearer lin_oauth_app_token_2");
  });

  it("keeps a token for the secret that minted it, not for whoever shares its client id", async () => {
    const { module, asked, connect } = linearReturning({ DeevyWho: who });
    const other = connect({ clientId: "lin_client_id_1", clientSecret: "lin_client_secret_2" });

    await module.identity();
    await other.identity();

    expect(asked.filter((one) => one.operation === "client_credentials")).toHaveLength(2);
    const calls = asked.filter((one) => one.url === "https://api.linear.app/graphql");
    expect(calls.map((one) => one.authorization)).toEqual([
      "Bearer lin_oauth_app_token_1",
      "Bearer lin_oauth_app_token_2",
    ]);
  });

  it("hands nobody a token for another Socket's client id and a wrong secret", async () => {
    // A client id is public, and when deevy is hosted one isolate serves many
    // Workspaces: a token cached by the id alone would answer anyone who
    // pasted it, before the secret ever reached Linear.
    const { module, asked, connect } = linearReturning(
      { DeevyWho: who },
      { secrets: { lin_client_id_1: "lin_client_secret_1" } },
    );
    await module.identity();

    const impostor = connect({ clientId: "lin_client_id_1", clientSecret: "a guess" });

    await expect(impostor.identity()).rejects.toThrow(/invalid_client/);
    expect(asked.at(-1)?.form).toMatchObject({ client_secret: "a guess" });
    const calls = asked.filter((one) => one.url === "https://api.linear.app/graphql");
    expect(calls).toHaveLength(1);
  });

  it("says in Linear's words when it does not know the client id and secret", async () => {
    const { module } = linearReturning({ DeevyWho: who }, { unknownClient: true });

    // A sentence and Linear's code, never the JSON it came in: this is what an
    // admin reads when connecting fails (operations/sockets.ts).
    await expect(module.identity()).rejects.toThrow(
      /^Invalid client: client is invalid \(invalid_client\)$/,
    );
  });

  it("says what Linear said when it refuses something else", async () => {
    const { tracker } = linearReturning({});

    await expect(tracker.createComment(scope, ref, "Said")).rejects.toThrow(
      "No answer for DeevyCommentCreate",
    );
  });
});

describe("who deevy is on Linear", () => {
  it("is the app's own user, and connecting learns which workspace it is in", async () => {
    const { module } = linearReturning({ DeevyWho: who });

    expect(await module.identity()).toEqual({
      login: "deevy",
      id: APP_USER,
      mentionHandle: "@deevy",
      learned: { organizationId: ORG, organizationName: "Acme", urlKey: "acme" },
    });
    // An account id means nothing without the workspace that issued it
    // (ADR-0025). A Linear user's id is one workspace's, and it is the id a
    // Sign in with Linear keeps: a Human who signed in to deevy with this
    // workspace's account rules here with no linking step. Settings ›
    // Identities still links on Linear's own page, since a sign-in could be
    // to another workspace.
    expect(module.identityScope).toEqual({
      instance: ORG,
      signInProvider: "linear",
      linkBySignIn: false,
    });
  });
});

describe("the tracker", () => {
  it("offers each team as a container, named the way Linear shows it", async () => {
    const { tracker } = linearReturning({
      DeevyTeams: {
        teams: {
          nodes: [
            { id: TEAM, key: "ENG", name: "Engineering" },
            { id: "a1b2c3d4-0000-4000-8000-000000000001", key: "OPS", name: "Operations" },
          ],
        },
      },
    });

    expect(await tracker.listContainers()).toEqual([
      { scope: { scopeKey: TEAM, teamKey: "ENG" }, scopeKey: TEAM, name: "Engineering (ENG)" },
      {
        scope: { scopeKey: "a1b2c3d4-0000-4000-8000-000000000001", teamKey: "OPS" },
        scopeKey: "a1b2c3d4-0000-4000-8000-000000000001",
        name: "Operations (OPS)",
      },
    ]);
  });

  it("comments as the app, and answers where the comment is", async () => {
    const { tracker, asked } = linearReturning({
      DeevyCommentCreate: {
        commentCreate: { success: true, comment: { id: "c9", url: `${ref.url}#comment-c9` } },
      },
    });

    const posted = await tracker.createComment(scope, ref, "Approved: **1 of 2**.");

    expect(posted).toEqual({ externalId: "c9", url: `${ref.url}#comment-c9` });
    expect(asked.at(-1)?.variables).toEqual({
      input: { issueId: ISSUE, body: "Approved: **1 of 2**." },
    });
  });
});

describe("a Human proving a Linear account is theirs", () => {
  it("is sent to Linear to consent as themselves, reading nothing but who they are", () => {
    const { module } = linearReturning({});

    const url = new URL(
      module.accountLink?.authorizeUrl({
        redirectUri: "https://deevy.test/api/identities/linear/callback",
        state: "signed-state",
      }) ?? "",
    );

    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "lin_client_id_1",
      redirect_uri: "https://deevy.test/api/identities/linear/callback",
      response_type: "code",
      scope: "read",
      state: "signed-state",
      // Always asked, so the Human sees which workspace they are consenting in.
      prompt: "consent",
    });
  });

  it("comes back with a code deevy spends once, reads the account with, and gives back", async () => {
    const { module, asked } = linearReturning({
      "token:authorization_code": {
        access_token: "lin_oauth_grace_token",
        token_type: "Bearer",
        expires_in: 86399,
        scope: "read",
        refresh_token: "lin_refresh_grace",
      },
      DeevyWho: {
        viewer: { id: "5a1b7c3e", name: "Grace Hopper", displayName: "grace" },
        organization: { id: ORG, name: "Acme", urlKey: "acme" },
      },
    });

    const account = await module.accountLink?.account({
      code: "the-one-use-code",
      redirectUri: "https://deevy.test/api/identities/linear/callback",
    });

    expect(account).toEqual({ id: "5a1b7c3e", login: "grace", instance: ORG });
    expect(asked[0]?.form).toMatchObject({
      grant_type: "authorization_code",
      code: "the-one-use-code",
      redirect_uri: "https://deevy.test/api/identities/linear/callback",
      client_id: "lin_client_id_1",
      client_secret: "lin_client_secret_1",
    });
    expect(asked.find((one) => one.operation === "DeevyWho")?.authorization).toBe(
      "Bearer lin_oauth_grace_token",
    );
    // deevy keeps nothing of the Human's: the token is revoked once it has
    // said who they are.
    expect(asked.at(-1)).toMatchObject({
      url: "https://api.linear.app/oauth/revoke",
      form: { token: "lin_oauth_grace_token" },
    });
  });
});

describe("letting people assign issues to deevy", () => {
  it("starts on Linear's own page, as an install of the app by a workspace admin", () => {
    const { module } = linearReturning({});

    const url = new URL(
      module.install?.({ redirectUri: "https://deevy.test/hooks/sock_1/setup", state: "signed" }) ??
        "",
    );

    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "lin_client_id_1",
      redirect_uri: "https://deevy.test/hooks/sock_1/setup",
      response_type: "code",
      scope: "read,write,app:assignable,app:mentionable",
      state: "signed",
      actor: "app",
    });
  });

  it("is an install as the app, finished at the setup redirect and recorded on the Socket", async () => {
    const { module, asked } = linearReturning({
      "token:authorization_code": {
        access_token: "lin_oauth_install_token",
        token_type: "Bearer",
        expires_in: 86399,
        scope: "read write app:assignable app:mentionable",
        refresh_token: "lin_refresh_install",
      },
      DeevyWho: who,
    });

    const result = await module.setup?.({
      params: { code: "install-code", state: "signed" },
      redirectUri: "https://deevy.test/hooks/sock_1/setup",
    });

    expect(result).toMatchObject({ config: { assignable: true } });
    expect(asked[0]?.form).toMatchObject({
      grant_type: "authorization_code",
      redirect_uri: "https://deevy.test/hooks/sock_1/setup",
    });
  });

  it("refuses an install in another workspace than the one this Socket reads", async () => {
    const { module } = linearReturning({
      "token:authorization_code": { access_token: "t", token_type: "Bearer", expires_in: 1 },
      DeevyWho: { ...who, organization: { id: "another-org", name: "Other", urlKey: "other" } },
    });

    await expect(
      module.setup?.({ params: { code: "c" }, redirectUri: "https://deevy.test/hooks/s/setup" }),
    ).rejects.toThrow("another Linear workspace");
  });
});

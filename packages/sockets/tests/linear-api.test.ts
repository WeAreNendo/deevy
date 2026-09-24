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

/** An issue as Linear's API answers one, rather than as its webhook does. */
function apiIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE,
    identifier: "ENG-12",
    url: ref.url,
    title: "Checkout totals are wrong with a coupon",
    description: "A 10% coupon takes the total below zero.",
    updatedAt: "2026-09-24T09:14:05.311Z",
    parent: null,
    delegate: null,
    assignee: null,
    state: { name: "Todo", type: "unstarted" },
    labels: { nodes: [{ name: "Bug" }] },
    team: { id: TEAM },
    ...overrides,
  };
}

type Answer = object | ((variables: Record<string, unknown>, asked: Asked) => unknown);

/** A Linear that answers each named operation, and mints a token per client-credentials grant. */
function linearReturning(
  answers: Record<string, Answer>,
  options: { tokens?: string[]; refuse?: (asked: Asked) => boolean } = {},
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
      return Response.json(
        {
          errors: [
            {
              message: "Authentication required, not authenticated",
              extensions: { code: "AUTHENTICATION_ERROR" },
            },
          ],
        },
        { status: 400 },
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

  const module = createLinearSocket({
    config: { organizationId: ORG, urlKey: "acme" },
    credentials: { clientId: "lin_client_id_1", clientSecret: "lin_client_secret_1" },
    fetch: fetchImpl,
    now: () => new Date("2026-09-24T10:00:00Z"),
  });
  if (!module.tracker) throw new Error("a Linear Socket is a tracker");
  return { module, tracker: module.tracker, asked };
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
    // The scopes an app actor needs to read a team's issues and say things on
    // them, and nothing that administers the workspace.
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

  it("says what Linear said when it refuses something else", async () => {
    const { tracker } = linearReturning({});

    await expect(tracker.getIssue(scope, ref)).rejects.toThrow("No answer for DeevyIssue");
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
    // An account id means nothing without the workspace that issued it (ADR-0025).
    expect(module.identityScope).toEqual({ instance: ORG });
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

  it("reads one record by its id", async () => {
    const { tracker, asked } = linearReturning({
      DeevyIssue: {
        issue: apiIssue({
          parent: { id: "7e6d5c4b-3a29-4180-b7c6-d5e4f3a2b1c0" },
          delegate: { id: APP_USER },
          assignee: { id: "5a1b7c3e", name: "Grace Hopper" },
          state: { name: "Canceled", type: "canceled" },
        }),
      },
    });

    const issue = await tracker.getIssue(scope, ref);

    expect(asked.at(-1)?.variables).toEqual({ id: ISSUE });
    expect(issue).toEqual({
      externalId: ISSUE,
      key: "ENG-12",
      url: ref.url,
      title: "Checkout totals are wrong with a coupon",
      body: "A 10% coupon takes the total below zero.",
      state: "closed",
      stateName: "Canceled",
      assignees: [{ login: "Grace Hopper", id: "5a1b7c3e" }],
      labels: ["Bug"],
      parentExternalId: "7e6d5c4b-3a29-4180-b7c6-d5e4f3a2b1c0",
      delegateId: APP_USER,
      updatedAt: new Date("2026-09-24T09:14:05.311Z"),
    });
  });

  it("lists what changed since, oldest change first, so a catch-up walks forward", async () => {
    const { tracker, asked } = linearReturning({
      DeevyIssues: {
        issues: {
          // Linear orders by the newest change first, so the oldest page is the
          // last one: asked for with `last` and turned round here.
          nodes: [
            apiIssue({ id: "b", identifier: "ENG-14", updatedAt: "2026-09-24T09:30:00.000Z" }),
            apiIssue({ id: "a", identifier: "ENG-13", updatedAt: "2026-09-24T09:20:00.000Z" }),
          ],
          pageInfo: { hasPreviousPage: true, startCursor: "cursor-older" },
        },
      },
    });

    const page = await tracker.listIssues(scope, {
      updatedSince: new Date("2026-09-24T09:14:05.311Z"),
      cursor: null,
      limit: 2,
    });

    expect(page.issues.map((issue) => issue.key)).toEqual(["ENG-13", "ENG-14"]);
    expect(page.nextCursor).toBe("cursor-older");
    expect(asked.at(-1)?.variables).toEqual({
      filter: {
        team: { id: { eq: TEAM } },
        updatedAt: { gt: "2026-09-24T09:14:05.311Z" },
      },
      last: 2,
      before: null,
    });
  });

  it("reads a record's comments, with who wrote each and whether it was an app", async () => {
    const { tracker } = linearReturning({
      DeevyComments: {
        issue: {
          comments: {
            nodes: [
              {
                id: "c1",
                body: "Is this the spring coupon?",
                url: `${ref.url}#comment-c1`,
                createdAt: "2026-09-24T09:40:00.000Z",
                user: { id: "5a1b7c3e", name: "Grace Hopper", displayName: "grace" },
                botActor: null,
              },
              {
                id: "c2",
                body: "**Waiting on a ruling** at the `plan` Checkpoint.",
                url: `${ref.url}#comment-c2`,
                createdAt: "2026-09-24T09:41:00.000Z",
                user: { id: APP_USER, name: "deevy", displayName: "deevy" },
                botActor: { id: "bot", name: "deevy", type: "oauthClient" },
              },
            ],
          },
        },
      },
    });

    const comments = await tracker.listComments(scope, ref, 20);

    expect(comments).toEqual([
      {
        externalId: "c1",
        url: `${ref.url}#comment-c1`,
        body: "Is this the spring coupon?",
        // The handle Linear mentions by, where it says one.
        author: { login: "grace", id: "5a1b7c3e", isBot: false },
        createdAt: new Date("2026-09-24T09:40:00.000Z"),
      },
      expect.objectContaining({ author: { login: "deevy", id: APP_USER, isBot: true } }),
    ]);
  });

  it("opens a record under its parent natively, with its labels found or made by name", async () => {
    const { tracker, asked } = linearReturning({
      DeevyLabels: {
        issueLabels: {
          nodes: [
            { id: "label-other-team", name: "agent:builder", team: { id: "somewhere-else" } },
            { id: "label-workspace", name: "agent:builder", team: null },
          ],
        },
      },
      DeevyLabelCreate: (variables: Record<string, unknown>) => ({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: `label-made-${String((variables.input as { name: string }).name)}` },
        },
      }),
      DeevyIssueCreate: {
        issueCreate: {
          success: true,
          issue: apiIssue({
            id: "d1",
            identifier: "ENG-15",
            parent: { id: ISSUE },
            labels: { nodes: [{ name: "agent:builder" }, { name: "sub-task" }] },
          }),
        },
      },
    });

    const created = await tracker.createIssue(scope, {
      title: "Cap the coupon",
      body: "Split out of ENG-12.",
      parent: ref,
      labels: ["agent:builder", "sub-task"],
    });

    expect(created).toMatchObject({ key: "ENG-15", parentExternalId: ISSUE, parentLinked: true });
    expect(asked.find((one) => one.operation === "DeevyLabelCreate")?.variables).toEqual({
      input: { name: "sub-task", teamId: TEAM },
    });
    expect(asked.find((one) => one.operation === "DeevyIssueCreate")?.variables).toEqual({
      input: {
        teamId: TEAM,
        title: "Cap the coupon",
        description: "Split out of ENG-12.",
        parentId: ISSUE,
        // The workspace's own label, since this team has none of that name.
        labelIds: ["label-workspace", "label-made-sub-task"],
      },
    });
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

  it("adds a label it makes on first use, and takes one off by name", async () => {
    const { tracker, asked } = linearReturning({
      DeevyLabels: (variables: Record<string, unknown>) => ({
        issueLabels: {
          nodes: JSON.stringify(variables).includes("deevy:awaiting-approval")
            ? []
            : [{ id: "label-agent", name: "agent:planner", team: { id: TEAM } }],
        },
      }),
      DeevyLabelCreate: {
        issueLabelCreate: { success: true, issueLabel: { id: "label-awaiting" } },
      },
      DeevyLabelsChange: { issueUpdate: { success: true } },
    });

    await tracker.setLabels(scope, ref, { add: ["deevy:awaiting-approval"], remove: [] });
    await tracker.setLabels(scope, ref, { add: [], remove: ["agent:planner", "never-there"] });

    const changes = asked.filter((one) => one.operation === "DeevyLabelsChange");
    expect(changes.map((one) => one.variables)).toEqual([
      { id: ISSUE, input: { addedLabelIds: ["label-awaiting"], removedLabelIds: [] } },
      // A label that does not exist is not on the record, which is what was wanted.
      { id: ISSUE, input: { addedLabelIds: [], removedLabelIds: ["label-agent"] } },
    ]);
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

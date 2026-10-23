import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createGithubSocket, resetGithubTokens } from "../src/github/index.ts";
import installations from "./fixtures/github/app.installations.json" with { type: "json" };
import firstHundred from "./fixtures/github/installation.repositories.page-1.json" with { type: "json" };
import theRest from "./fixtures/github/installation.repositories.page-2.json" with { type: "json" };
import labeled from "./fixtures/github/issues.labeled.json" with { type: "json" };

/**
 * What the GitHub module asks GitHub, and what it makes of the answers.
 *
 * Every request goes through an injected `fetch` that answers recorded shapes
 * and records what was asked — never the network. What is being proved here is
 * the half a fixture cannot: which endpoint, with which credential, and what
 * deevy does when GitHub says no.
 */
afterEach(() => {
  resetGithubTokens();
});

function keyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

const { privateKey, publicKey } = keyPair();

/** Whether a JWT was signed by the key whose public half this is, as GitHub checks. */
function signedBy(publicKeyPem: string, jwt: string): boolean {
  const [header = "", payload = "", signature = ""] = jwt.split(".");
  const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (one) =>
    one.charCodeAt(0),
  );
  return verify(
    "RSA-SHA256",
    new TextEncoder().encode(`${header}.${payload}`),
    publicKeyPem,
    bytes,
  );
}

interface Asked {
  method: string;
  url: string;
  authorization: string;
  body: unknown;
}

/**
 * A GitHub that answers what each path is recorded to answer. An answer that
 * is a function is asked each time, with the request, for one that depends on
 * what was sent.
 */
function githubReturning(
  answers: Record<string, unknown>,
  options: {
    apiBase?: string;
    /** The public half of the one key GitHub takes a JWT from; any, when unsaid. */
    publicKey?: string;
  } = {},
) {
  const asked: Asked[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization") ?? "";
    const request: Asked = {
      method: init?.method ?? "GET",
      url,
      authorization,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    asked.push(request);
    const jwt = /^Bearer (eyJ\S+)$/.exec(authorization)?.[1];
    if (jwt && options.publicKey && !signedBy(options.publicKey, jwt)) {
      // As GitHub answers a JWT signed by a key the App does not have.
      return Promise.resolve(
        Response.json({ message: "A JSON web token could not be decoded" }, { status: 401 }),
      );
    }
    // Every host this fake stands for answers the same paths.
    const path = url.replace(/^https:\/\/[^/]+(?:\/api\/v3)?/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const recorded = answers[key] ?? answers[key.split("?")[0] ?? ""];
    const answer =
      typeof recorded === "function" ? (recorded as (one: Asked) => unknown)(request) : recorded;
    if (answer === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  }) as typeof fetch;

  /** Another Socket for the same App id, on this same GitHub, in this same isolate. */
  const connect = (other: {
    privateKey: string;
    apiBase?: string;
    /** Where the Socket already knows the App is installed. */
    installations?: { id: string; account: string }[];
  }) => {
    const apiBase = other.apiBase ?? options.apiBase;
    const module = createGithubSocket({
      config: {
        appId: "1284461",
        slug: "deevy",
        ...(apiBase ? { apiBase } : {}),
        installations: other.installations ?? [{ id: "61892041", account: "acme" }],
      },
      credentials: { privateKey: other.privateKey },
      fetch: fetchImpl,
      now: () => new Date("2026-09-21T10:00:00Z"),
    });
    if (!module.tracker) throw new Error("a GitHub Socket is a tracker");
    return { module, tracker: module.tracker };
  };

  return { ...connect({ privateKey }), asked, connect };
}

/** What every repository call needs first: which installation, and a token for it. */
const credentials = {
  "GET /repos/acme/deevy/installation": { id: 61892041 },
  "POST /app/installations/61892041/access_tokens": {
    token: "ghs_installation_token_for_acme",
    expires_at: "2026-09-21T11:00:00Z",
  },
};

const scope = { scopeKey: "acme/deevy" };
const ref = { externalId: "I_kwDOMxK7Zs6oF3S9", url: "https://github.com/acme/deevy/issues/42" };

describe("where the App delivers", () => {
  it("is pointed at deevy's address again, as the App, when that address moved", async () => {
    // A laptop behind a tunnel gets a new hostname more often than it gets a
    // new App: GitHub lets the App say where its one webhook goes.
    const { module, asked } = githubReturning({
      "PATCH /app/hook/config": {
        url: "https://new-tunnel.example.net/hooks/sock_1",
        content_type: "json",
      },
    });

    await module.rewire?.("https://new-tunnel.example.net/hooks/sock_1");

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      method: "PATCH",
      body: { url: "https://new-tunnel.example.net/hooks/sock_1", content_type: "json" },
    });
    expect(asked[0]?.authorization).toMatch(/^Bearer eyJ/);
  });
});

describe("how deevy authenticates", () => {
  it("asks as the App, then acts as the installation that covers the repository", async () => {
    const { tracker, asked } = githubReturning({
      ...credentials,
      "GET /repos/acme/deevy/issues/42": labeled.issue,
    });

    const issue = await tracker.getIssue(scope, ref);

    expect(issue.key).toBe("acme/deevy#42");
    // The App's own JWT for the two credential calls, the installation's token
    // for the repository call: a JWT cannot read an issue, and a token cannot
    // mint itself.
    expect(asked.map((one) => `${one.method} ${new URL(one.url).pathname}`)).toEqual([
      "GET /repos/acme/deevy/installation",
      "POST /app/installations/61892041/access_tokens",
      "GET /repos/acme/deevy/issues/42",
    ]);
    expect(asked[0]?.authorization).toMatch(/^Bearer eyJ/);
    expect(asked[2]?.authorization).toBe("Bearer ghs_installation_token_for_acme");
  });

  it("mints one token and keeps it, because GitHub's last an hour", async () => {
    const { tracker, asked } = githubReturning({
      ...credentials,
      "GET /repos/acme/deevy/issues/42": labeled.issue,
    });

    await tracker.getIssue(scope, ref);
    await tracker.getIssue(scope, ref);

    expect(asked.filter((one) => one.url.includes("access_tokens"))).toHaveLength(1);
    expect(asked.filter((one) => one.url.endsWith("/installation"))).toHaveLength(1);
  });

  it("keeps a token for the key that minted it, not for whoever shares its App id", async () => {
    // An App id is public, and when deevy is hosted one isolate serves many
    // Workspaces: a token cached by the id alone would answer anyone who
    // pasted it, before their key ever signed anything.
    const { tracker, asked, connect } = githubReturning(
      { ...credentials, "GET /repos/acme/deevy/issues/42": labeled.issue },
      { publicKey },
    );
    await tracker.getIssue(scope, ref);

    const impostor = connect({ privateKey: keyPair().privateKey });

    await expect(impostor.tracker.getIssue(scope, ref)).rejects.toThrow(/GitHub answered 401/);
    expect(asked.filter((one) => one.url.endsWith("/issues/42"))).toHaveLength(1);
    expect(asked.filter((one) => one.url.endsWith("/installation"))).toHaveLength(2);
  });

  it("asks again which installation covers a repository once the one it remembered is gone", async () => {
    // acme uninstalled the App and installed it again, a new installation
    // with a new id, while this isolate remembered the old one. The delivery
    // that said so may have reached another isolate, so GitHub's 404 is the news.
    const answers: Record<string, unknown> = {
      ...credentials,
      // Short-lived, so the next call mints again rather than reusing it.
      "POST /app/installations/61892041/access_tokens": {
        token: "ghs_old",
        expires_at: "2026-09-21T10:00:30Z",
      },
      "GET /repos/acme/deevy/issues/42": labeled.issue,
    };
    const { tracker, asked } = githubReturning(answers);
    await tracker.getIssue(scope, ref);

    delete answers["POST /app/installations/61892041/access_tokens"];
    answers["GET /repos/acme/deevy/installation"] = { id: 7 };
    answers["POST /app/installations/7/access_tokens"] = {
      token: "ghs_new",
      expires_at: "2026-09-21T11:00:00Z",
    };
    asked.length = 0;

    await tracker.getIssue(scope, ref);
    await tracker.getIssue(scope, ref);

    // The dead id is asked for once, and never again.
    expect(asked.map((one) => `${one.method} ${new URL(one.url).pathname}`)).toEqual([
      "POST /app/installations/61892041/access_tokens",
      "GET /repos/acme/deevy/installation",
      "POST /app/installations/7/access_tokens",
      "GET /repos/acme/deevy/issues/42",
      "GET /repos/acme/deevy/issues/42",
    ]);
    expect(asked.at(-1)?.authorization).toBe("Bearer ghs_new");
  });

  it("mints for each key, and for each host, rather than sharing one App id's token", async () => {
    const { tracker, asked, connect } = githubReturning({
      ...credentials,
      "GET /repos/acme/deevy/issues/42": labeled.issue,
    });

    await tracker.getIssue(scope, ref);
    await connect({ privateKey: keyPair().privateKey }).tracker.getIssue(scope, ref);
    await connect({ privateKey, apiBase: "https://github.acme.test/api/v3" }).tracker.getIssue(
      scope,
      ref,
    );

    const minted = asked.filter((one) => one.url.includes("access_tokens"));
    expect(minted.map((one) => new URL(one.url).host)).toEqual([
      "api.github.com",
      "api.github.com",
      "github.acme.test",
    ]);
  });

  it("says who deevy is there, which is the App's own bot account", async () => {
    const { module } = githubReturning({
      "GET /app": {
        id: 1284461,
        slug: "deevy",
        name: "deevy",
        html_url: "https://github.com/apps/deevy",
      },
      "GET /app/installations": installations,
    });

    expect(await module.identity()).toEqual({
      login: "deevy[bot]",
      id: "1284461",
      mentionHandle: "@deevy",
      // What the manifest's conversion would have said, for an App that was
      // pasted: its page, to install it on more from, and where it is
      // installed, since an App pasted after it was installed never sent
      // anybody through the install's redirect.
      learned: {
        slug: "deevy",
        htmlUrl: "https://github.com/apps/deevy",
        installations: [{ id: "61892041", account: "acme" }],
      },
    });
  });

  it("learns every page of where the App is installed, less what GitHub suspended", async () => {
    const full = Array.from({ length: 100 }, (_, at) => ({
      id: 1000 + at,
      account: { login: `org-${String(at)}` },
      suspended_at: null,
    }));
    const { module, asked } = githubReturning({
      "GET /app": { id: 1284461, slug: "deevy", name: "deevy" },
      "GET /app/installations?per_page=100&page=1": full,
      "GET /app/installations?per_page=100&page=2": [
        ...installations,
        { id: 7, account: { login: "paused-org" }, suspended_at: "2026-09-20T00:00:00Z" },
      ],
    });

    const learned = (await module.identity()).learned?.installations as { account: string }[];

    // A short page is the last one, and a suspended installation mints no
    // token, so it is nowhere the App works.
    expect(learned).toHaveLength(101);
    expect(learned.at(-1)).toEqual({ id: "61892041", account: "acme" });
    expect(learned.map((one) => one.account)).not.toContain("paused-org");
    const listed = asked.filter((one) => one.url.includes("/app/installations"));
    expect(listed).toHaveLength(2);
    // As the App: these are the App's installations, which no installation's token lists.
    expect(listed.every((one) => one.authorization.startsWith("Bearer eyJ"))).toBe(true);
  });

  it("stops learning installations at a hundred pages, whatever the server answers", async () => {
    const full = Array.from({ length: 100 }, (_, at) => ({
      id: 1000 + at,
      account: { login: "a" },
    }));
    const { module, asked } = githubReturning({
      "GET /app": { id: 1284461, slug: "deevy", name: "deevy" },
      // The same full page for every `page`.
      "GET /app/installations": full,
    });

    await module.identity();

    expect(asked.filter((one) => one.url.includes("/app/installations"))).toHaveLength(100);
  });

  it("talks to a GitHub Enterprise Server where one is configured", async () => {
    const apiBase = "https://github.acme.test/api/v3";
    const { module, asked } = githubReturning(
      {
        "GET /app": {
          id: 1,
          slug: "deevy",
          name: "deevy",
          html_url: "https://github.acme.test/github-apps/deevy",
        },
        "GET /app/installations": [],
      },
      { apiBase },
    );

    const { learned } = await module.identity();

    expect(asked[0]?.url).toBe(`${apiBase}/app`);
    expect(asked[1]?.url).toBe(`${apiBase}/app/installations?per_page=100&page=1`);
    // The server's own page for the App, never one deevy builds on github.com.
    expect(learned?.htmlUrl).toBe("https://github.acme.test/github-apps/deevy");
  });
});

describe("reading a repository", () => {
  it("walks what changed since, oldest first, and leaves pull requests alone", async () => {
    const { tracker, asked } = githubReturning({
      ...credentials,
      "GET /repos/acme/deevy/issues": [
        labeled.issue,
        { ...labeled.issue, node_id: "PR_1", number: 44, pull_request: { url: "…" } },
      ],
    });

    const page = await tracker.listIssues(scope, {
      updatedSince: new Date("2026-09-20T00:00:00Z"),
      cursor: null,
      limit: 2,
    });

    // A pull request is evidence on a record, never a record (ADR-0024).
    expect(page.issues.map((issue) => issue.key)).toEqual(["acme/deevy#42"]);
    // The page was full, so there is more: the next call carries on.
    expect(page.nextCursor).toBe("2");
    const query = new URL(asked[2]?.url ?? "").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      state: "all",
      sort: "updated",
      direction: "asc",
      since: "2026-09-20T00:00:00.000Z",
      page: "1",
      per_page: "2",
    });
  });

  it("reads the conversation, which deevy stores none of", async () => {
    const { tracker } = githubReturning({
      ...credentials,
      "GET /repos/acme/deevy/issues/42/comments": [
        {
          node_id: "IC_1",
          body: "Looks right",
          html_url: "https://github.com/acme/deevy/issues/42#issuecomment-1",
          created_at: "2026-09-21T09:00:00Z",
          user: { login: "grace-on-github", id: 5829302, type: "User" },
        },
      ],
    });

    const comments = await tracker.listComments(scope, ref, 20);

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      externalId: "IC_1",
      body: "Looks right",
      author: { login: "grace-on-github", isBot: false },
    });
  });

  it("offers the repositories the App was installed on", async () => {
    const { tracker } = githubReturning({
      "POST /app/installations/61892041/access_tokens": {
        token: "ghs_token",
        expires_at: "2026-09-21T11:00:00Z",
      },
      "GET /installation/repositories": {
        repositories: [
          { full_name: "acme/deevy", name: "deevy", default_branch: "main" },
          { full_name: "acme/ops", name: "ops", default_branch: "trunk" },
        ],
      },
    });

    // Each with the branch it defaults to, so binding one as a Project's code
    // gives its Runs the right base without anybody typing it.
    expect(await tracker.listContainers()).toEqual([
      {
        scope: { scopeKey: "acme/deevy", baseBranch: "main" },
        scopeKey: "acme/deevy",
        name: "acme/deevy",
      },
      {
        scope: { scopeKey: "acme/ops", baseBranch: "trunk" },
        scopeKey: "acme/ops",
        name: "acme/ops",
      },
    ]);
  });

  it("asks GitHub where the App is installed when the Socket knows of nowhere", async () => {
    // A Socket pasted before deevy learned installations at connect: its
    // configuration lists none, though GitHub has had the App installed all along.
    const { connect, asked } = githubReturning({
      "GET /app/installations": installations,
      "POST /app/installations/61892041/access_tokens": {
        token: "ghs_token",
        expires_at: "2026-09-21T11:00:00Z",
      },
      "GET /installation/repositories": {
        repositories: [{ full_name: "acme/deevy", name: "deevy", default_branch: "main" }],
      },
    });
    const { tracker } = connect({ privateKey, installations: [] });

    const containers = await tracker.listContainers();

    expect(containers.map((one) => one.scopeKey)).toEqual(["acme/deevy"]);
    expect(asked.map((one) => `${one.method} ${new URL(one.url).pathname}`)).toEqual([
      "GET /app/installations",
      "POST /app/installations/61892041/access_tokens",
      "GET /installation/repositories",
    ]);
  });

  it("offers every installation GitHub has, though the Socket kept only one", async () => {
    // Pasted before deevy learned installations, installed on acme and on
    // acme-labs, then told of acme alone by one delivery: what the Socket
    // keeps names acme, and GitHub names both.
    const repositoryFor: Record<string, string> = {
      "Bearer ghs_acme": "acme/deevy",
      "Bearer ghs_labs": "acme-labs/site",
    };
    const fetchImpl = ((input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/app/installations") {
        return Promise.resolve(
          Response.json([...installations, { id: 7, account: { login: "acme-labs" } }]),
        );
      }
      const minted = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname)?.[1];
      if (minted) {
        const token = minted === "7" ? "ghs_labs" : "ghs_acme";
        return Promise.resolve(Response.json({ token, expires_at: "2026-09-21T11:00:00Z" }));
      }
      const full = repositoryFor[new Headers(init?.headers).get("authorization") ?? ""] ?? "";
      return Promise.resolve(
        Response.json({ repositories: [{ full_name: full, name: full, default_branch: "main" }] }),
      );
    }) as typeof fetch;
    const module = createGithubSocket({
      config: { appId: "1284461", installations: [{ id: "61892041", account: "acme" }] },
      credentials: { privateKey },
      fetch: fetchImpl,
      now: () => new Date("2026-09-21T10:00:00Z"),
    });

    const containers = await module.tracker?.listContainers();

    expect(containers?.map((one) => one.scopeKey)).toEqual(["acme/deevy", "acme-labs/site"]);
  });

  it("offers every page of an installation's repositories, not only the first hundred", async () => {
    // As GitHub answered for an installation on 101: its largest page, then one more.
    const { tracker, asked } = githubReturning({
      "POST /app/installations/61892041/access_tokens": {
        token: "ghs_token",
        expires_at: "2026-09-21T11:00:00Z",
      },
      "GET /installation/repositories?per_page=100&page=1": firstHundred,
      "GET /installation/repositories?per_page=100&page=2": theRest,
    });

    const containers = await tracker.listContainers();

    expect(containers).toHaveLength(101);
    expect(containers[0]?.scopeKey).toBe("acme/deevy");
    expect(containers.at(-1)).toEqual({
      scope: { scopeKey: "acme/ops", baseBranch: "trunk" },
      scopeKey: "acme/ops",
      name: "acme/ops",
    });
    // A short page is the last one, and both are read with the one token.
    const listed = asked.filter((one) => one.url.includes("/installation/repositories"));
    expect(listed).toHaveLength(2);
    expect(listed.every((one) => one.authorization === "Bearer ghs_token")).toBe(true);
    expect(asked.filter((one) => one.url.includes("access_tokens"))).toHaveLength(1);
  });

  it("stops at a hundred pages where a server answers the same full page for every one", async () => {
    // Every `page` is answered with the first hundred, as a proxy that drops
    // the query would: read to a short page, the list would never end.
    const { tracker, asked } = githubReturning({
      "POST /app/installations/61892041/access_tokens": {
        token: "ghs_token",
        expires_at: "2026-09-21T11:00:00Z",
      },
      "GET /installation/repositories": firstHundred,
    });

    await tracker.listContainers();

    expect(asked.filter((one) => one.url.includes("/installation/repositories"))).toHaveLength(100);
  });

  it("offers what the other installations cover when one will not mint a token", async () => {
    // acme-labs uninstalled the App while deevy was not listening: GitHub
    // answers 404 for its token, and acme's repositories are still bindable.
    const { connect } = githubReturning({
      "POST /app/installations/61892041/access_tokens": {
        token: "ghs_token",
        expires_at: "2026-09-21T11:00:00Z",
      },
      "GET /installation/repositories": {
        repositories: [{ full_name: "acme/deevy", name: "deevy", default_branch: "main" }],
      },
    });
    const both = [
      { id: "7", account: "acme-labs" },
      { id: "61892041", account: "acme" },
    ];

    const containers = await connect({ privateKey, installations: both }).tracker.listContainers();

    expect(containers.map((one) => one.scopeKey)).toEqual(["acme/deevy"]);
  });

  it("offers nothing of an installation that refuses halfway through its pages", async () => {
    // acme answers its first hundred, then its token stops working, as an
    // uninstall halfway through does: half a list would read as all of it, so
    // acme offers nothing and acme-labs what it has.
    const tokenFor: Record<string, string> = { "61892041": "ghs_acme", "7": "ghs_labs" };
    const fetchImpl = ((input: string, init?: RequestInit) => {
      const url = new URL(input);
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
      const minted = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname)?.[1];
      if (minted) {
        return Promise.resolve(
          Response.json({ token: tokenFor[minted], expires_at: "2026-09-21T11:00:00Z" }),
        );
      }
      const page = url.searchParams.get("page");
      if (url.pathname === "/installation/repositories") {
        if (token === "ghs_acme" && page === "1")
          return Promise.resolve(Response.json(firstHundred));
        if (token === "ghs_labs" && page === "1") return Promise.resolve(Response.json(theRest));
        return Promise.resolve(Response.json({ message: "Bad credentials" }, { status: 401 }));
      }
      // Where the App is installed cannot be asked, so what the Socket keeps is used.
      return Promise.resolve(Response.json({ message: "Server Error" }, { status: 502 }));
    }) as typeof fetch;
    const module = createGithubSocket({
      config: {
        appId: "1284461",
        installations: [
          { id: "61892041", account: "acme" },
          { id: "7", account: "acme-labs" },
        ],
      },
      credentials: { privateKey },
      fetch: fetchImpl,
      now: () => new Date("2026-09-21T10:00:00Z"),
    });

    const containers = await module.tracker?.listContainers();

    expect(containers?.map((one) => one.scopeKey)).toEqual(["acme/ops"]);
  });

  it("says GitHub is busy or down rather than offering a shorter list", async () => {
    // A rate limit, said either way GitHub says one, or a server error: none
    // is GitHub saying the installation is gone, so none hides its repositories.
    for (const [status, headers] of [
      [429, { "retry-after": "60" }],
      [403, { "x-ratelimit-remaining": "0" }],
      [502, {}],
    ] as const) {
      resetGithubTokens();
      const fetchImpl = ((input: string) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/access_tokens")) {
          return Promise.resolve(
            Response.json({ token: "ghs_token", expires_at: "2026-09-21T11:00:00Z" }),
          );
        }
        if (url.pathname === "/installation/repositories") {
          return Promise.resolve(Response.json({ message: "Slow down" }, { status, headers }));
        }
        return Promise.resolve(Response.json({ message: "Not Found" }, { status: 404 }));
      }) as typeof fetch;
      const module = createGithubSocket({
        config: { appId: "1284461", installations: [{ id: "61892041", account: "acme" }] },
        credentials: { privateKey },
        fetch: fetchImpl,
        now: () => new Date("2026-09-21T10:00:00Z"),
      });

      await expect(module.tracker?.listContainers()).rejects.toThrow(
        `GitHub answered ${String(status)}`,
      );
    }
  });

  it("says why when no installation will answer, since then it is the App", async () => {
    const { connect } = githubReturning({});

    await expect(
      connect({
        privateKey,
        installations: [{ id: "7", account: "acme-labs" }],
      }).tracker.listContainers(),
    ).rejects.toThrow(/GitHub answered 404 for \/app\/installations\/7\/access_tokens/);
  });
});

describe("writing to a repository", () => {
  it("opens a record and links it under its parent", async () => {
    const { tracker, asked } = githubReturning({
      ...credentials,
      "POST /repos/acme/deevy/issues": { ...labeled.issue, id: 2847193099, node_id: "I_child" },
      "POST /repos/acme/deevy/issues/42/sub_issues": { id: 1 },
    });

    const opened = await tracker.createIssue(scope, {
      title: "Cap the coupon",
      body: "One part of it",
      parent: ref,
      labels: ["agent:builder"],
    });

    expect(opened.parentLinked).toBe(true);
    expect(asked.at(-2)?.body).toMatchObject({
      title: "Cap the coupon",
      labels: ["agent:builder"],
    });
    // The sub-issue call takes the child's numeric id, which is the one place
    // GitHub wants that rather than the node id.
    expect(asked.at(-1)?.body).toEqual({ sub_issue_id: 2847193099 });
  });

  it("keeps the record when GitHub will not link the parent", async () => {
    // A GitHub Enterprise Server without the sub-issues API answers 404, and
    // deevy keeps the tree itself (ADR-0022): the record is still opened.
    const { tracker } = githubReturning({
      ...credentials,
      "POST /repos/acme/deevy/issues": { ...labeled.issue, id: 2847193099, node_id: "I_child" },
    });

    const opened = await tracker.createIssue(scope, {
      title: "Cap the coupon",
      body: "",
      parent: ref,
      labels: [],
    });

    expect(opened.parentLinked).toBe(false);
    expect(opened.externalId).toBe("I_child");
  });

  it("says something on the record, and answers where it landed", async () => {
    const { tracker, asked } = githubReturning({
      ...credentials,
      "POST /repos/acme/deevy/issues/42/comments": {
        node_id: "IC_new",
        html_url: "https://github.com/acme/deevy/issues/42#issuecomment-9",
      },
    });

    const wrote = await tracker.createComment(scope, ref, "— Planner · via deevy");

    expect(wrote).toEqual({
      externalId: "IC_new",
      url: "https://github.com/acme/deevy/issues/42#issuecomment-9",
    });
    expect(asked.at(-1)?.body).toEqual({ body: "— Planner · via deevy" });
  });

  it("adds a label in one call and takes each one off in its own", async () => {
    const { tracker, asked } = githubReturning({
      ...credentials,
      "POST /repos/acme/deevy/issues/42/labels": [],
      "DELETE /repos/acme/deevy/issues/42/labels/deevy:awaiting-approval": [],
    });

    await tracker.setLabels(scope, ref, {
      add: ["deevy:awaiting-approval"],
      // One that is not on the issue: GitHub answers 404 and the state deevy
      // wanted is the state there is, so nothing is thrown.
      remove: ["deevy:awaiting-approval", "never-was-here"],
    });

    const writes = asked.filter((one) => one.url.includes("/labels"));
    expect(writes.map((one) => one.method)).toEqual(["POST", "DELETE", "DELETE"]);
    expect(writes[0]?.body).toEqual({ labels: ["deevy:awaiting-approval"] });
  });
});

describe("the repository behind a Project", () => {
  /**
   * As GitHub mints: a token of its own each time, narrowed to what the
   * request named. A Run's is told apart from deevy's own by its prefix.
   */
  function mintingFor(installation: string, answers: Record<string, unknown> = {}) {
    let minted = 0;
    return {
      ...answers,
      [`POST /app/installations/${installation}/access_tokens`]: (request: Asked) => {
        minted += 1;
        const narrowed = typeof request.body === "object" && request.body !== null;
        return {
          token: `${narrowed ? "ghs_run" : "ghs_installation"}_${String(minted)}`,
          expires_at: "2026-09-21T11:00:00Z",
        };
      },
    };
  }

  const repository = { id: 812745, clone_url: "https://github.com/acme/deevy.git" };

  function minting() {
    return mintingFor("61892041", {
      ...credentials,
      "GET /repos/acme/deevy": repository,
      "GET /repos/acme/deevy/issues/42": labeled.issue,
    });
  }

  const narrowed = { repository_ids: [812745], permissions: { contents: "write" } };

  it("mints a credential a Run can clone with, and says when it dies", async () => {
    const { module, asked } = githubReturning(minting());
    if (!module.forge) throw new Error("a GitHub Socket is a forge");

    const credential = await module.forge.credential(scope);

    expect(credential).toMatchObject({
      cloneUrl: "https://github.com/acme/deevy.git",
      // GitHub's own name for an installation token used over HTTPS.
      username: "x-access-token",
      secret: "ghs_run_2",
    });
    expect(credential.expiresAt?.toISOString()).toBe("2026-09-21T11:00:00.000Z");
    // The repository is read with deevy's own token, and the Run's is minted
    // as the App for that one repository's code alone: no issues, no pull
    // requests, and no other repository of the installation.
    expect(asked.map((one) => `${one.method} ${new URL(one.url).pathname}`)).toEqual([
      "GET /repos/acme/deevy/installation",
      "POST /app/installations/61892041/access_tokens",
      "GET /repos/acme/deevy",
      "POST /app/installations/61892041/access_tokens",
    ]);
    expect(asked[2]?.authorization).toBe("Bearer ghs_installation_1");
    expect(asked[3]?.authorization).toMatch(/^Bearer eyJ/);
    expect(asked[3]?.body).toEqual(narrowed);
  });

  it("mints for a renamed repository by its id, which the rename kept", async () => {
    // The Project was bound to acme/coupons, since renamed acme/deevy: GitHub
    // follows the old name to the repository, and a token asked for under
    // that name would be refused.
    const { module, asked } = githubReturning(
      mintingFor("61892041", {
        "GET /repos/acme/coupons/installation": { id: 61892041 },
        "GET /repos/acme/coupons": repository,
      }),
    );
    if (!module.forge) throw new Error("a GitHub Socket is a forge");

    const credential = await module.forge.credential({ scopeKey: "acme/coupons" });

    expect(credential.cloneUrl).toBe("https://github.com/acme/deevy.git");
    expect(asked.at(-1)?.body).toEqual(narrowed);
  });

  it("never hands a Run the token deevy makes its own calls with", async () => {
    const { module, tracker, asked } = githubReturning(minting());
    if (!module.forge) throw new Error("a GitHub Socket is a forge");

    // deevy's own token, minted for the installation and kept for its hour.
    await tracker.getIssue(scope, ref);
    const first = await module.forge.credential(scope);
    // A Run resumed after a Gate asks again, and is given another.
    const resumed = await module.forge.credential(scope);
    await tracker.getIssue(scope, ref);

    expect(first.secret).toBe("ghs_run_2");
    expect(resumed.secret).toBe("ghs_run_3");
    const minted = asked.filter((one) => one.url.includes("access_tokens"));
    expect(minted.map((one) => one.body)).toEqual([undefined, narrowed, narrowed]);
    // And a Run's token never takes the cached one's place: every call deevy
    // makes as the installation is made with the token it minted for itself.
    const asInstallation = asked.filter((one) => !one.authorization.startsWith("Bearer eyJ"));
    expect(asInstallation).toHaveLength(4);
    expect(new Set(asInstallation.map((one) => one.authorization))).toEqual(
      new Set(["Bearer ghs_installation_1"]),
    );
  });

  it("asks again which installation covers the repository when a Run's is gone", async () => {
    // As deevy's own calls do: an installation id remembered from before acme
    // reinstalled the App is refused with a 404, and asked for once. Here a
    // Run resumed after a Gate is the first to find out.
    const answers: Record<string, unknown> = minting();
    const { module, asked } = githubReturning(answers);
    if (!module.forge) throw new Error("a GitHub Socket is a forge");
    await module.forge.credential(scope);

    delete answers["POST /app/installations/61892041/access_tokens"];
    Object.assign(answers, mintingFor("7"), { "GET /repos/acme/deevy/installation": { id: 7 } });
    asked.length = 0;

    const resumed = await module.forge.credential(scope);

    expect(resumed.secret).toBe("ghs_run_1");
    expect(asked.map((one) => `${one.method} ${new URL(one.url).pathname}`)).toEqual([
      "GET /repos/acme/deevy",
      "POST /app/installations/61892041/access_tokens",
      "GET /repos/acme/deevy/installation",
      "POST /app/installations/7/access_tokens",
    ]);
    expect(asked.at(-1)?.body).toEqual(narrowed);
  });

  it("opens the pull request, and answers where it is", async () => {
    const { module, asked } = githubReturning({
      ...credentials,
      "POST /repos/acme/deevy/pulls": {
        html_url: "https://github.com/acme/deevy/pull/7",
        number: 7,
      },
    });
    if (!module.forge) throw new Error("a GitHub Socket is a forge");

    const opened = await module.forge.openPullRequest(scope, {
      head: "deevy/acme-deevy-42-run_abc1",
      base: "main",
      title: "acme/deevy#42: cap the coupon",
      body: "Closes https://github.com/acme/deevy/issues/42",
    });

    expect(opened).toEqual({ url: "https://github.com/acme/deevy/pull/7", number: 7 });
    expect(asked.at(-1)?.body).toMatchObject({
      head: "deevy/acme-deevy-42-run_abc1",
      base: "main",
    });
  });

  it("repeats GitHub's own refusal, which is the one a Human can act on", async () => {
    const { module } = githubReturning(credentials);
    if (!module.forge) throw new Error("a GitHub Socket is a forge");

    // No `pulls` answer: GitHub 404s, and what comes back says so rather than
    // "something went wrong".
    await expect(
      module.forge.openPullRequest(scope, { head: "x", base: "main", title: "t", body: "b" }),
    ).rejects.toThrow(/404/);
  });
});

import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createGithubSocket, resetGithubTokens } from "../src/github/index.ts";
import { socketModules } from "../src/index.ts";

/**
 * Finishing a GitHub App off (ADR-0024).
 *
 * Connecting GitHub is two redirects rather than a paste: the operator makes
 * the App from a manifest deevy wrote, GitHub sends them back with a one-use
 * `code`, and deevy trades it for the App's own credentials. Installing it
 * afterwards is the second redirect, and the only thing it carries is an id.
 */
afterEach(() => {
  resetGithubTokens();
});

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function githubReturning(answers: Record<string, unknown>, config: Record<string, unknown> = {}) {
  const asked: Array<{ method: string; url: string }> = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push({ method: init?.method ?? "GET", url });
    const answer = answers[`${init?.method ?? "GET"} ${url.replace("https://api.github.com", "")}`];
    if (answer === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  }) as typeof fetch;

  const module = createGithubSocket({
    config: { appId: "", ...config },
    credentials: config.credentials === undefined ? {} : (config.credentials as never),
    fetch: fetchImpl,
    now: () => new Date("2026-09-21T10:00:00Z"),
  });
  if (!module.setup) throw new Error("a GitHub Socket has a setup step");
  const setup = module.setup.bind(module);
  return { setup, asked };
}

describe("where deevy can make the App", () => {
  /** The GitHub module as an entry builds it, for a Socket with this configuration. */
  function github(config: Record<string, unknown>, githubApiBase?: string) {
    const make = socketModules(githubApiBase ? { githubApiBase } : {}).github;
    if (!make) throw new Error("every build speaks GitHub");
    return make({ config, credentials: {}, fetch, now: () => new Date() });
  }

  it("is github.com, whose manifest form deevy's page may post", () => {
    expect(github({}).beginRefusal).toBeUndefined();
    expect(github({ apiBase: "https://api.github.com" }).beginRefusal).toBeUndefined();
    // A Socket of its own on github.com, on a deployment whose default is not.
    expect(
      github({ apiBase: "https://api.github.com" }, "https://github.example.com/api/v3")
        .beginRefusal,
    ).toBeUndefined();
  });

  it("is nowhere on a GitHub Enterprise Server, whose App is made there and pasted", () => {
    // The deployment's (`DEEVY_GITHUB_API`), or one a Socket carries itself.
    for (const module of [
      github({}, "https://github.example.com/api/v3"),
      github({ apiBase: "https://github.example.com/api/v3" }),
      // GHE.com is another GitHub too, on a host of its own.
      github({ apiBase: "https://api.acme.ghe.com" }),
    ]) {
      expect(module.beginRefusal).toMatch(/GitHub Enterprise Server or GHE.com/);
      expect(module.beginRefusal).toMatch(/Paste an App you already have/);
      // Said to an admin on a screen, so in its words and none of the API's.
      expect(module.beginRefusal).not.toMatch(/sockets\.|appId|privateKey/);
    }
  });

  it("is refused in words when the Socket's API address is not one", () => {
    for (const apiBase of [42, "not an address", "ftp://github.example.com", { url: "x" }]) {
      expect(() => github({ apiBase })).toThrow(/^That is not the address of a GitHub API/);
    }
  });
});

describe("the App an operator just made", () => {
  it("is traded for its own credentials, and deevy keeps what it may", async () => {
    const { setup, asked } = githubReturning({
      "POST /app-manifests/abc123/conversions": {
        id: 1284461,
        slug: "deevy-acme",
        name: "deevy (acme)",
        pem: privateKey,
        webhook_secret: "whsec_github_made_this_one",
        client_id: "Iv1.9f8e7d6c5b4a",
        client_secret: "0123456789abcdef0123456789abcdef01234567",
        owner: { login: "acme" },
        html_url: "https://github.com/apps/deevy-acme",
      },
    });

    const result = await setup({ params: { code: "abc123" } });

    expect(asked).toEqual([
      { method: "POST", url: "https://api.github.com/app-manifests/abc123/conversions" },
    ]);
    // The App's id and slug are configuration; the key and the client secret
    // are credentials and are sealed by the route (secrets.ts).
    expect(result.config).toMatchObject({
      appId: "1284461",
      slug: "deevy-acme",
      // Where the App lives on GitHub, for the Socket's page to link to.
      htmlUrl: "https://github.com/apps/deevy-acme",
    });
    expect(result.credentials).toMatchObject({
      privateKey,
      clientId: "Iv1.9f8e7d6c5b4a",
      clientSecret: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(result.webhookSecret).toBe("whsec_github_made_this_one");
    // Who deevy is there, settled without a second call: the App's own bot.
    expect(result.identity).toEqual({
      login: "deevy-acme[bot]",
      id: "1284461",
      mentionHandle: "@deevy-acme",
    });
    expect(result.summary).toContain("deevy (acme)");
    // Straight on to installing it, which is the step that gives it anything
    // to work: the first real walk landed back in deevy with an App installed
    // nowhere and no way on from there. GitHub's own address for the App, so a
    // GitHub Enterprise Server's is right too.
    expect(result.redirectTo).toBe("https://github.com/apps/deevy-acme/installations/new");
  });

  it("finishes an App an organization owns exactly as one a person owns", async () => {
    // Made from `github.com/organizations/acme-inc/settings/apps/new`, which is
    // what Connect GitHub posts to when it is given an organization. The App's
    // page is `/apps/<slug>` whoever owns it, and its install page offers the
    // account that owns it, so nothing here may read the owner's own address.
    const { setup } = githubReturning({
      "POST /app-manifests/org123/conversions": {
        id: 2390117,
        slug: "acme-inc-on-github",
        name: "acme-inc on GitHub",
        pem: privateKey,
        webhook_secret: "whsec_github_made_this_one",
        client_id: "Iv23li9f8e7d6c5b4a",
        client_secret: "0123456789abcdef0123456789abcdef01234567",
        owner: {
          login: "acme-inc",
          type: "Organization",
          html_url: "https://github.com/acme-inc",
        },
        html_url: "https://github.com/apps/acme-inc-on-github",
      },
    });

    const result = await setup({ params: { code: "org123" } });

    expect(result.config).toMatchObject({
      appId: "2390117",
      htmlUrl: "https://github.com/apps/acme-inc-on-github",
    });
    expect(result.identity?.login).toBe("acme-inc-on-github[bot]");
    expect(result.redirectTo).toBe("https://github.com/apps/acme-inc-on-github/installations/new");
  });

  it("refuses a code GitHub will not take, rather than half-connecting", async () => {
    const { setup } = githubReturning({});

    await expect(setup({ params: { code: "stale" } })).rejects.toThrow(/404/);
  });
});

describe("the installation that follows", () => {
  it("is checked with GitHub before deevy writes it down", async () => {
    const { setup, asked } = githubReturning(
      {
        "GET /app/installations/61892041": {
          id: 61892041,
          account: { login: "acme", type: "Organization" },
        },
      },
      { appId: "1284461", credentials: { privateKey } },
    );

    const result = await setup({
      params: { installation_id: "61892041", setup_action: "install" },
    });

    // Whoever is at the URL could type any number: what GitHub says about the
    // id is what deevy records, and an id it does not know is refused.
    expect(asked[0]?.url).toBe("https://api.github.com/app/installations/61892041");
    expect(result.config).toEqual({ installations: [{ id: "61892041", account: "acme" }] });
    expect(result.summary).toContain("acme");
  });

  it("keeps the installations it already had", async () => {
    const { setup } = githubReturning(
      {
        "GET /app/installations/7": { id: 7, account: { login: "second-org" } },
      },
      {
        appId: "1284461",
        credentials: { privateKey },
        installations: [{ id: "61892041", account: "acme" }],
      },
    );

    const result = await setup({ params: { installation_id: "7" } });

    // One App serves every account that installs it, so this is a list that
    // grows rather than a field that is replaced (docs/plans/sockets.md).
    expect(result.config).toEqual({
      installations: [
        { id: "61892041", account: "acme" },
        { id: "7", account: "second-org" },
      ],
    });
  });

  it("keeps one entry for an installation, however the redirect spelled its id", async () => {
    const { setup } = githubReturning(
      { "GET /app/installations/061892041": { id: 61892041, account: { login: "acme" } } },
      {
        appId: "1284461",
        credentials: { privateKey },
        installations: [{ id: "61892041", account: "acme" }],
      },
    );

    // The query string is whoever is at the URL; GitHub's own id is the one kept.
    const result = await setup({ params: { installation_id: "061892041" } });

    expect(result.config).toEqual({ installations: [{ id: "61892041", account: "acme" }] });
  });

  it("writes down no installation GitHub has suspended", async () => {
    const { setup } = githubReturning(
      {
        "GET /app/installations/7": {
          id: 7,
          account: { login: "second-org" },
          suspended_at: "2026-10-20T09:00:00Z",
        },
      },
      { appId: "1284461", credentials: { privateKey } },
    );

    const result = await setup({ params: { installation_id: "7" } });

    // It mints no token until it is unsuspended, which GitHub delivers.
    expect(result.config).toBeUndefined();
    expect(result.summary).toMatch(/second-org.*suspended/);
  });

  it("says what it cannot finish, rather than doing nothing quietly", async () => {
    const { setup } = githubReturning({}, { appId: "1284461", credentials: { privateKey } });

    await expect(setup({ params: {} })).rejects.toThrow(/nothing to finish/i);
  });
});

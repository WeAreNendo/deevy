import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createGithubSocket, resetGithubTokens } from "../src/github/index.ts";

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
      },
    });

    const result = await setup({ params: { code: "abc123" } });

    expect(asked).toEqual([
      { method: "POST", url: "https://api.github.com/app-manifests/abc123/conversions" },
    ]);
    // The App's id and slug are configuration; the key and the client secret
    // are credentials and are sealed by the route (secrets.ts).
    expect(result.config).toMatchObject({ appId: "1284461", slug: "deevy-acme" });
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

  it("says what it cannot finish, rather than doing nothing quietly", async () => {
    const { setup } = githubReturning({}, { appId: "1284461", credentials: { privateKey } });

    await expect(setup({ params: {} })).rejects.toThrow(/nothing to finish/i);
  });
});

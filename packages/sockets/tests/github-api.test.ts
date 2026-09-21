import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createGithubSocket, resetGithubTokens } from "../src/github/index.ts";
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

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

interface Asked {
  method: string;
  url: string;
  authorization: string;
  body: unknown;
}

/** A GitHub that answers what each path is recorded to answer. */
function githubReturning(answers: Record<string, unknown>, options: { apiBase?: string } = {}) {
  const asked: Asked[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    asked.push({
      method: init?.method ?? "GET",
      url,
      authorization: headers.get("authorization") ?? "",
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const key = `${init?.method ?? "GET"} ${url.replace(options.apiBase ?? "https://api.github.com", "")}`;
    const answer = answers[key] ?? answers[key.split("?")[0] ?? ""];
    if (answer === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  }) as typeof fetch;

  const module = createGithubSocket({
    config: {
      appId: "1284461",
      slug: "deevy",
      ...(options.apiBase ? { apiBase: options.apiBase } : {}),
      installations: [{ id: "61892041", account: "acme" }],
    },
    credentials: { privateKey },
    fetch: fetchImpl,
    now: () => new Date("2026-09-21T10:00:00Z"),
  });
  if (!module.tracker) throw new Error("a GitHub Socket is a tracker");
  return { module, tracker: module.tracker, asked };
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

  it("says who deevy is there, which is the App's own bot account", async () => {
    const { module } = githubReturning({
      "GET /app": { id: 1284461, slug: "deevy", name: "deevy" },
    });

    expect(await module.identity()).toEqual({
      login: "deevy[bot]",
      id: "1284461",
      mentionHandle: "@deevy",
    });
  });

  it("talks to a GitHub Enterprise Server where one is configured", async () => {
    const apiBase = "https://github.acme.test/api/v3";
    const { module, asked } = githubReturning(
      { "GET /app": { id: 1, slug: "deevy", name: "deevy" } },
      { apiBase },
    );

    await module.identity();

    expect(asked[0]?.url).toBe(`${apiBase}/app`);
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
          { full_name: "acme/deevy", name: "deevy" },
          { full_name: "acme/ops", name: "ops" },
        ],
      },
    });

    expect(await tracker.listContainers()).toEqual([
      { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
      { scope: { scopeKey: "acme/ops" }, scopeKey: "acme/ops", name: "acme/ops" },
    ]);
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

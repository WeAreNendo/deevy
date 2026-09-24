import { describe, expect, it } from "vite-plus/test";
import { createGitlabSocket } from "../src/gitlab/index.ts";

/**
 * What the GitLab module asks GitLab, and what it makes of the answers.
 *
 * Every request goes through an injected `fetch` that answers recorded shapes
 * and writes down what was asked — never the network. What is proved here is
 * the half a webhook fixture cannot: which endpoint, with which credential, and
 * what deevy does when GitLab says no.
 */
interface Asked {
  method: string;
  path: string;
  authorization: string;
  body: Record<string, unknown> | undefined;
}

/** An issue as GitLab's REST API answers one, rather than as its webhook does. */
function apiIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 88104233,
    iid: 42,
    project_id: 4211,
    title: "Checkout totals are wrong with a coupon",
    description: "A 10% coupon takes the total below zero.",
    state: "opened",
    labels: ["bug"],
    assignees: [],
    web_url: "https://gitlab.com/acme/deevy/-/issues/42",
    updated_at: "2026-09-24T09:14:05.311Z",
    references: { short: "#42", relative: "#42", full: "acme/deevy#42" },
    ...overrides,
  };
}

/** A GitLab that answers what each `METHOD /path` is recorded to answer. */
function gitlabReturning(
  answers: Record<string, unknown>,
  options: { baseUrl?: string; signInIssuer?: string } = {},
) {
  const asked: Asked[] = [];
  const base = `${options.baseUrl ?? "https://gitlab.com"}/api/v4`;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const path = url.replace(base, "");
    asked.push({
      method,
      path,
      authorization: headers.get("authorization") ?? "",
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    });
    const answer = answers[`${method} ${path}`] ?? answers[`${method} ${path.split("?")[0] ?? ""}`];
    if (answer === undefined) {
      return Response.json({ message: "404 Not found" }, { status: 404 });
    }
    return Response.json(answer, { status: method === "POST" ? 201 : 200 });
  }) as typeof fetch;

  const module = createGitlabSocket(
    {
      config: options.baseUrl ? { baseUrl: options.baseUrl } : {},
      credentials: { token: "glpat-deevy-bot-token" },
      fetch: fetchImpl,
      now: () => new Date("2026-09-24T10:00:00Z"),
    },
    options.signInIssuer ? { signInIssuer: options.signInIssuer } : {},
  );
  if (!module.tracker || !module.forge) throw new Error("a GitLab Socket is a tracker and a forge");
  return { module, tracker: module.tracker, forge: module.forge, asked };
}

const scope = { scopeKey: "4211", path: "acme/deevy" };
const ref = { externalId: "88104233", url: "https://gitlab.com/acme/deevy/-/issues/42" };

describe("who deevy is on GitLab", () => {
  it("is the user its token belongs to, asked with that token", async () => {
    const { module, asked } = gitlabReturning({
      "GET /user": { id: 7001, username: "deevy-bot", name: "deevy", bot: true },
    });

    expect(await module.identity()).toEqual({
      login: "deevy-bot",
      id: "7001",
      mentionHandle: "@deevy-bot",
    });
    expect(asked[0]?.authorization).toBe("Bearer glpat-deevy-bot-token");
  });

  it("lives on gitlab.com, whose accounts are the ones deevy signs people in with", () => {
    const { module } = gitlabReturning({});

    // So a Human who signed in to deevy with GitLab rules from GitLab with no
    // linking step, as one who signed in with GitHub does from github.com.
    expect(module.identityScope).toEqual({ instance: "gitlab.com", signInProvider: "gitlab" });
  });

  it("shares nothing with sign-in on another instance, unless that is the one people sign in with", () => {
    const own = gitlabReturning({}, { baseUrl: "https://gitlab.example.com" });
    const signedInThere = gitlabReturning(
      {},
      { baseUrl: "https://gitlab.example.com", signInIssuer: "https://gitlab.example.com" },
    );

    expect(own.module.identityScope).toEqual({ instance: "gitlab.example.com" });
    expect(signedInThere.module.identityScope).toEqual({
      instance: "gitlab.example.com",
      signInProvider: "gitlab",
    });
  });
});

describe("the tracker", () => {
  it("offers each project the token can work in as a container, by path", async () => {
    const { tracker, asked } = gitlabReturning({
      "GET /projects": [
        { id: 4211, path_with_namespace: "acme/deevy", name_with_namespace: "Acme / deevy" },
      ],
    });

    expect(await tracker.listContainers()).toEqual([
      { scope: { scopeKey: "4211", path: "acme/deevy" }, scopeKey: "4211", name: "acme/deevy" },
    ]);
    // Only projects its user is a member of with Developer or more: the ones
    // it could push a branch to and comment on.
    expect(asked[0]?.path).toContain("membership=true");
    expect(asked[0]?.path).toContain("min_access_level=30");
  });

  it("reads one record by the number in its URL", async () => {
    const { tracker, asked } = gitlabReturning({
      "GET /projects/4211/issues/42": apiIssue({
        state: "closed",
        assignees: [{ id: 1044, username: "ada", name: "Ada Lovelace" }],
      }),
    });

    const issue = await tracker.getIssue(scope, ref);

    expect(asked[0]?.path).toBe("/projects/4211/issues/42");
    expect(issue).toEqual({
      externalId: "88104233",
      key: "acme/deevy#42",
      url: "https://gitlab.com/acme/deevy/-/issues/42",
      title: "Checkout totals are wrong with a coupon",
      body: "A 10% coupon takes the total below zero.",
      state: "closed",
      stateName: "closed",
      assignees: [{ login: "ada", id: "1044" }],
      labels: ["bug"],
      parentExternalId: null,
      updatedAt: new Date("2026-09-24T09:14:05.311Z"),
    });
  });

  it("lists what changed since, oldest change first, a page at a time", async () => {
    const { tracker, asked } = gitlabReturning({
      "GET /projects/4211/issues": [
        apiIssue({ id: 1, iid: 43, references: { full: "acme/deevy#43" } }),
        apiIssue({ id: 2, iid: 44, references: { full: "acme/deevy#44" } }),
      ],
    });

    const page = await tracker.listIssues(scope, {
      updatedSince: new Date("2026-09-24T09:00:00Z"),
      cursor: null,
      limit: 2,
    });

    expect(page.issues.map((issue) => issue.key)).toEqual(["acme/deevy#43", "acme/deevy#44"]);
    expect(page.nextCursor).toBe("2");
    const query = new URLSearchParams(asked[0]?.path.split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({
      scope: "all",
      state: "all",
      order_by: "updated_at",
      sort: "asc",
      per_page: "2",
      page: "1",
      updated_after: "2026-09-24T09:00:00.000Z",
    });
  });

  it("reads a record's comments, leaving out what GitLab wrote itself", async () => {
    const { tracker } = gitlabReturning({
      "GET /projects/4211/issues/42/notes": [
        {
          id: 501,
          body: "Is this the spring coupon?",
          system: false,
          created_at: "2026-09-24T09:40:00.000Z",
          author: { id: 2931, username: "grace", name: "Grace Hopper" },
        },
        {
          id: 502,
          body: "added ~agent:planner label",
          system: true,
          created_at: "2026-09-24T09:41:00.000Z",
          author: { id: 2931, username: "grace", name: "Grace Hopper" },
        },
      ],
    });

    expect(await tracker.listComments(scope, ref, 20)).toEqual([
      {
        externalId: "501",
        url: "https://gitlab.com/acme/deevy/-/issues/42#note_501",
        body: "Is this the spring coupon?",
        author: { login: "grace", id: "2931", isBot: false },
        createdAt: new Date("2026-09-24T09:40:00.000Z"),
      },
    ]);
  });

  it("opens a record with its labels, and relates it to its parent, which is all GitLab has", async () => {
    const { tracker, asked } = gitlabReturning({
      "POST /projects/4211/issues": apiIssue({
        id: 88104300,
        iid: 43,
        labels: ["agent:builder", "sub-task"],
        references: { full: "acme/deevy#43" },
        web_url: "https://gitlab.com/acme/deevy/-/issues/43",
      }),
      "POST /projects/4211/issues/43/links": { source_issue: {}, target_issue: {} },
    });

    const created = await tracker.createIssue(scope, {
      title: "Cap the coupon",
      body: "Split out of acme/deevy#42.",
      parent: ref,
      labels: ["agent:builder", "sub-task"],
    });

    expect(asked[0]).toMatchObject({
      method: "POST",
      path: "/projects/4211/issues",
      body: {
        title: "Cap the coupon",
        description: "Split out of acme/deevy#42.",
        labels: "agent:builder,sub-task",
      },
    });
    expect(asked[1]).toMatchObject({
      method: "POST",
      path: "/projects/4211/issues/43/links",
      body: { target_project_id: "4211", target_issue_iid: "42", link_type: "relates_to" },
    });
    // A relation is not a parent: deevy keeps the tree itself (ADR-0022).
    expect(created).toMatchObject({ key: "acme/deevy#43", parentLinked: false });
  });

  it("comments, and answers where the comment is", async () => {
    const { tracker, asked } = gitlabReturning({
      "POST /projects/4211/issues/42/notes": { id: 1990442799, body: "Approved: **1 of 2**." },
    });

    const posted = await tracker.createComment(scope, ref, "Approved: **1 of 2**.");

    expect(asked[0]?.body).toEqual({ body: "Approved: **1 of 2**." });
    expect(posted).toEqual({
      externalId: "1990442799",
      url: "https://gitlab.com/acme/deevy/-/issues/42#note_1990442799",
    });
  });

  it("adds and takes off labels in one call, making one it has never seen", async () => {
    const { tracker, asked } = gitlabReturning({
      "PUT /projects/4211/issues/42": apiIssue(),
    });

    await tracker.setLabels(scope, ref, { add: ["deevy:awaiting-approval"], remove: [] });
    await tracker.setLabels(scope, ref, { add: [], remove: ["deevy:awaiting-approval"] });

    expect(asked.map((one) => one.body)).toEqual([
      { add_labels: "deevy:awaiting-approval" },
      { remove_labels: "deevy:awaiting-approval" },
    ]);
  });

  it("says what GitLab said when it refuses", async () => {
    const { tracker } = gitlabReturning({});

    await expect(tracker.getIssue(scope, ref)).rejects.toThrow("GitLab answered 404");
  });
});

/**
 * The forge half, as slice 6 proved it against GitHub (ADR-0014, ADR-0019):
 * what a Run clones with, and the merge request deevy opens for it.
 */
describe("the repository", () => {
  it("is cloned over HTTPS with the Socket's own token, as GitLab's oauth2 user", async () => {
    const { forge } = gitlabReturning({
      "GET /projects/4211": {
        id: 4211,
        http_url_to_repo: "https://gitlab.com/acme/deevy.git",
        default_branch: "main",
      },
    });

    expect(await forge.credential(scope)).toEqual({
      cloneUrl: "https://gitlab.com/acme/deevy.git",
      username: "oauth2",
      secret: "glpat-deevy-bot-token",
      expiresAt: null,
    });
  });

  it("gets a merge request from the Run's branch, which goes when it is merged", async () => {
    const { forge, asked } = gitlabReturning({
      "POST /projects/4211/merge_requests": {
        iid: 7,
        web_url: "https://gitlab.com/acme/deevy/-/merge_requests/7",
      },
    });

    const opened = await forge.openPullRequest(scope, {
      head: "deevy/acme-deevy-42-abcd1234",
      base: "main",
      title: "acme/deevy#42: Cap the coupon",
      body: "Cap the coupon.\n\nCloses https://gitlab.com/acme/deevy/-/issues/42",
    });

    expect(opened).toEqual({
      url: "https://gitlab.com/acme/deevy/-/merge_requests/7",
      number: 7,
      // GitLab's own words, which is what the link on the record says.
      label: "Merge request !7",
    });
    expect(asked[0]?.body).toEqual({
      source_branch: "deevy/acme-deevy-42-abcd1234",
      target_branch: "main",
      title: "acme/deevy#42: Cap the coupon",
      description: "Cap the coupon.\n\nCloses https://gitlab.com/acme/deevy/-/issues/42",
      remove_source_branch: true,
    });
  });
});

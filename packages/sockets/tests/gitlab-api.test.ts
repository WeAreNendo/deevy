import type { TrackerSocket } from "@deevy/core/sockets";
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
    // A refusal, answered exactly as GitLab answered it.
    if (answer instanceof Response) return answer.clone();
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
  const { tracker } = module;
  if (!tracker?.listContainers) {
    throw new Error("a GitLab Socket is a tracker that offers projects");
  }
  // Checked just above: the binding picker lists the projects its user is in.
  return {
    module,
    tracker: tracker as TrackerSocket & Required<Pick<TrackerSocket, "listContainers">>,
    asked,
  };
}

const scope = { scopeKey: "4211", path: "acme/deevy" };
const ref = { externalId: "88104233", url: "https://gitlab.com/acme/deevy/-/issues/42" };

describe("who deevy is on GitLab", () => {
  it("is the user its token belongs to, asked with that token", async () => {
    const { module, asked } = gitlabReturning({
      "GET /user": { id: 7001, username: "deevy-bot", name: "deevy", bot: true },
      "GET /personal_access_tokens/self": { id: 11, name: "deevy", scopes: ["api"], active: true },
    });

    expect(await module.identity()).toEqual({
      login: "deevy-bot",
      id: "7001",
      mentionHandle: "@deevy-bot",
    });
    expect(asked[0]?.authorization).toBe("Bearer glpat-deevy-bot-token");
    // And what the token may do, which `/user` answers for any token at all.
    expect(asked.map((one) => one.path)).toContain("/personal_access_tokens/self");
  });

  it("refuses a token that cannot write, and says which scope it needs", async () => {
    // A `read_user` token answers `/user` and nothing else deevy asks: it
    // connected, and then every comment failed.
    const { module } = gitlabReturning({
      "GET /user": { id: 7001, username: "deevy-bot", name: "deevy", bot: true },
      "GET /personal_access_tokens/self": {
        id: 11,
        name: "deevy",
        scopes: ["read_user", "read_api"],
        active: true,
      },
    });

    await expect(module.identity()).rejects.toThrow(
      "This token has read_user, read_api; deevy needs the api scope to comment on issues",
    );
  });

  it("trusts a GitLab that cannot say what a token may do", async () => {
    // An OAuth token, or a GitLab older than the endpoint: `/user` is proof enough.
    const { module } = gitlabReturning({
      "GET /user": { id: 7001, username: "deevy-bot", name: "deevy", bot: true },
    });

    await expect(module.identity()).resolves.toMatchObject({ login: "deevy-bot" });
  });

  it("says in GitLab's words when it does not know the token", async () => {
    const { module } = gitlabReturning({
      // As gitlab.com answered a made-up token on 2026-09-25.
      "GET /user": Response.json({ message: "401 Unauthorized" }, { status: 401 }),
    });

    await expect(module.identity()).rejects.toThrow(/^401 Unauthorized \(GET \/user\)$/);
  });

  it("says which scope a refused call needed", async () => {
    const { tracker } = gitlabReturning({
      [`POST /projects/4211/issues/42/notes`]: Response.json(
        {
          error: "insufficient_scope",
          error_description:
            "The request requires higher privileges than provided by the access token.",
          scope: "api",
        },
        { status: 403 },
      ),
    });

    await expect(tracker.createComment(scope, ref, "Said")).rejects.toThrow(
      "The request requires higher privileges than provided by the access token. (insufficient_scope, needs api) (POST /projects/4211/issues/42/notes)",
    );
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
        {
          id: 4211,
          path_with_namespace: "acme/deevy",
          name_with_namespace: "Acme / deevy",
          default_branch: "trunk",
        },
      ],
    });

    expect(await tracker.listContainers()).toEqual([
      {
        scope: { scopeKey: "4211", path: "acme/deevy" },
        scopeKey: "4211",
        name: "acme/deevy",
      },
    ]);
    // Only projects its user is a member of with Reporter or more: the ones
    // whose issues it can comment on.
    expect(asked[0]?.path).toContain("membership=true");
    expect(asked[0]?.path).toContain("min_access_level=20");
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

  it("says what GitLab said when it refuses", async () => {
    const { tracker } = gitlabReturning({});

    await expect(tracker.createComment(scope, ref, "Said")).rejects.toThrow(
      "404 Not found (POST /projects/4211/issues/42/notes)",
    );
  });
});

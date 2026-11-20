import type { ChatGateMessage } from "@deevy/core/sockets";
import { describe, expect, it } from "vite-plus/test";
import { createGenericSocket } from "../src/generic/index.ts";
import { createGithubSocket } from "../src/github/index.ts";
import { createGitlabSocket } from "../src/gitlab/index.ts";
import { socketModules } from "../src/index.ts";
import { createLinearSocket } from "../src/linear/index.ts";
import { createSlackSocket } from "../src/slack/index.ts";
import { createStubSocket } from "../src/stub/index.ts";
import githubComment from "./fixtures/github/issue_comment.created.json" with { type: "json" };
import gitlabNote from "./fixtures/gitlab/note.approve.json" with { type: "json" };
import linearComment from "./fixtures/linear/Comment.create.json" with { type: "json" };

/**
 * A Ruling is made in deevy (docs/plans/simplify.md, slice 10; ADR-0036).
 *
 * So a tool hands deevy what was said on a record and nothing more: a comment
 * that starts `/approve` is a comment, no module says whose an account on it
 * is, and a chat tool is told about a Gate and links to it, and takes nothing
 * back.
 */

const nobody = () => Promise.reject(new Error("no request expected"));
const now = () => new Date("2026-11-20T10:00:00Z");

/** What every tracker is built with here: nothing to call, nothing to hold. */
function built<T>(create: (input: Parameters<typeof createGithubSocket>[0]) => T, config = {}) {
  return create({ config, credentials: {}, fetch: nobody, now });
}

describe("a comment that starts /approve", () => {
  it("is a comment from GitHub", () => {
    const tracker = built(createGithubSocket, { appId: "1284461", slug: "deevy" }).tracker;
    const approving = {
      ...githubComment,
      comment: { ...githubComment.comment, body: "/approve\n\nReads right to me." },
    };

    const [event, ...more] = tracker?.normalize("issue_comment", approving) ?? [];

    expect(more).toEqual([]);
    expect(event).toMatchObject({
      kind: "comment",
      comment: { body: "/approve\n\nReads right to me." },
    });
  });

  it("is a comment from GitLab", () => {
    const tracker = built(createGitlabSocket).tracker;

    const [event, ...more] = tracker?.normalize("Note Hook", gitlabNote) ?? [];

    expect(more).toEqual([]);
    expect(event).toMatchObject({ kind: "comment" });
    expect(event?.kind === "comment" ? event.comment.body : "").toMatch(/^\/approve/);
  });

  it("is a comment from Linear", () => {
    const tracker = built(createLinearSocket, {
      organizationId: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    }).tracker;
    const approving = { ...linearComment, data: { ...linearComment.data, body: "/approve" } };

    const [event, ...more] = tracker?.normalize("Comment", approving) ?? [];

    expect(more).toEqual([]);
    expect(event).toMatchObject({ kind: "comment", comment: { body: "/approve" } });
  });

  it("is a comment through deevy's own format, and a ruling event is no event deevy takes", () => {
    for (const create of [createGenericSocket, createStubSocket]) {
      const tracker = built(create).tracker;
      const comment = {
        externalId: "c1",
        url: "https://tracker.test/7#c1",
        body: "/approve",
        author: { login: "ada", id: "1001", isBot: false },
        createdAt: "2026-11-20T10:00:00Z",
      };

      const events = tracker?.normalize("events", {
        events: [
          { kind: "comment", scopeKey: "acme/checkout", issueExternalId: "7", comment },
          {
            kind: "ruling",
            scopeKey: "acme/checkout",
            issueExternalId: "7",
            comment,
            decision: "approved",
            note: null,
          },
        ],
      });

      expect(events?.map((event) => event.kind)).toEqual(["comment", "ignored"]);
    }
  });
});

describe("an account on a tool", () => {
  it("is nobody's to deevy: no module links one, or says whose one is", () => {
    const modules = socketModules({ devStub: true });
    for (const [provider, create] of Object.entries(modules)) {
      const module = create?.({ config: {}, credentials: {}, fetch: nobody, now });
      expect(module, provider).toBeDefined();
      for (const said of ["accountLink", "identityScope", "vouches"]) {
        expect(module, `${provider} has ${said}`).not.toHaveProperty(said);
      }
    }
  });
});

const openGate: ChatGateMessage = {
  gateRequestId: "gate_k3xr8v2m9qpw",
  issueKey: "acme/deevy#42",
  issueUrl: "https://github.com/acme/deevy/issues/42",
  checkpoint: "plan",
  proposal: "Cap the coupon at the basket total.",
  agentName: "Planner",
  runId: "run_b1msparh0000",
  status: "open",
  approvals: 1,
  required: 2,
  url: "https://deevy.example.com/gates/gate_k3xr8v2m9qpw",
  rulings: ["Bob approved"],
};

describe("a Gate in Slack", () => {
  function slack() {
    const sent: unknown[] = [];
    const module = createSlackSocket({
      config: { teamId: "T07ACME001" },
      credentials: { botToken: "xoxb-not-a-real-token" },
      fetch: (_input, init) => {
        sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
        return Promise.resolve(
          Response.json({ ok: true, channel: "C07DEEVY01", ts: "1758625200.000100" }),
        );
      },
      now,
    });
    if (!module.chat) throw new Error("a Slack Socket is a chat tool");
    return { module, chat: module.chat, sent };
  }

  it("is posted with a link to rule on it in deevy, and no button", async () => {
    const { chat, sent } = slack();

    await chat.post("C07DEEVY01", { kind: "gate", gate: openGate });

    const drawn = JSON.stringify((sent[0] as { blocks: unknown[] }).blocks);
    expect(drawn).toContain("<https://deevy.example.com/gates/gate_k3xr8v2m9qpw|");
    expect(drawn).toContain("1 of 2");
    expect(drawn).not.toContain('"type":"actions"');
    expect(drawn).not.toContain('"type":"button"');
  });

  it("is all Slack is told: the module takes no request from Slack and holds no signing secret", () => {
    const { module, chat } = slack();

    expect(module.webhookSecretFrom).toBe("none");
    expect(Object.keys(chat).sort()).toEqual(["listChannels", "post", "update"]);
  });
});

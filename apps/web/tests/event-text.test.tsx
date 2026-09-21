import { describe, expect, it } from "vite-plus/test";
import { describeEvent } from "../src/lib/event-text.ts";

const ctx = {
  memberName: (id: string) => ({ "m-ada": "Ada", "m-bob": "Bob" })[id],
};

describe("describeEvent", () => {
  it("names the Member a record was routed to", () => {
    expect(
      describeEvent({ kind: "issue.assigned", payload: { from: "m-ada", to: "m-bob" } }, ctx)?.text,
    ).toBe("assigned it to Bob (was Ada)");
    expect(
      describeEvent({
        kind: "issue.assigned",
        payload: { from: null, to: "m-bob", toName: "Builder" },
      })?.text,
    ).toBe("assigned it to Builder");
    expect(
      describeEvent({ kind: "issue.assigned", payload: { from: "m-ada", to: null } }, ctx)?.text,
    ).toBe("unassigned it (was Ada)");
  });

  it("gives Runs their words and folds their routine steps", () => {
    expect(
      describeEvent({
        kind: "run.started",
        payload: { trigger: "assignment" },
        actorKind: "agent",
      }),
    ).toMatchObject({
      text: "started a Run, by assignment",
      tone: "agent",
      routine: true,
    });
    expect(
      describeEvent({ kind: "run.failed", payload: { summary: "Tests timed out." } }),
    ).toMatchObject({
      text: "failed the Run",
      detail: "Tests timed out.",
      tone: "destructive",
      routine: false,
    });
    expect(describeEvent({ kind: "run.went_stale", payload: null })?.text).toBe("went quiet");
    expect(describeEvent({ kind: "run.activity", payload: {} })).toBeNull();
  });

  it("says what a Run is waiting on, and quotes the question", () => {
    expect(
      describeEvent({
        kind: "run.awaiting_input",
        payload: { question: "Exponential or fixed?" },
        actorKind: "agent",
      }),
    ).toMatchObject({
      text: "is waiting on a Human",
      detail: "Exponential or fixed?",
      tone: "agent",
    });
  });

  it("names what an Agent linked to a record, by its host", () => {
    expect(
      describeEvent({
        kind: "issue.link_added",
        payload: { kind: "pull_request", url: "https://example.com/acme/deevy/pull/7" },
        actorKind: "agent",
      }),
    ).toMatchObject({
      text: "added a pull_request on example.com",
      detail: "https://example.com/acme/deevy/pull/7",
      tone: "agent",
      routine: true,
    });
    expect(
      describeEvent({ kind: "issue.link_removed", payload: { url: "https://example.com/x" } })
        ?.text,
    ).toBe("removed a link");
  });

  it("gives a comment the voice of whoever wrote it", () => {
    expect(
      describeEvent({ kind: "comment.created", payload: { commentId: "c1" }, actorKind: "agent" }),
    ).toMatchObject({ text: "commented", tone: "agent" });
    // No kind known: a Human's, as before.
    expect(describeEvent({ kind: "comment.created", payload: { commentId: "c1" } })).toMatchObject({
      text: "commented",
      tone: "human",
    });
  });

  it("reads the Workspace's own Events for the log", () => {
    expect(describeEvent({ kind: "member.joined", payload: { role: "admin" } })?.text).toBe(
      "joined as admin",
    );
    expect(describeEvent({ kind: "some.unknown", payload: {} })?.text).toBe("some.unknown");
  });

  /**
   * An admin reading Settings › Event log saw the literal `invitation.created`
   * where the payload already carried the address and the role
   * (docs/plans/sign-in.md).
   */
  it("says who was invited, and what became of the invitation", () => {
    expect(
      describeEvent({
        kind: "invitation.created",
        payload: { email: "grace@example.com", role: "member" },
      })?.text,
    ).toBe("invited grace@example.com as member");
    expect(
      describeEvent({
        kind: "invitation.revoked",
        payload: { email: "grace@example.com", role: "member" },
      }),
    ).toMatchObject({
      text: "revoked the invitation for grace@example.com",
      tone: "destructive",
    });
    expect(
      describeEvent({
        kind: "invitation.accepted",
        payload: { email: "grace@example.com", role: "admin" },
      })?.text,
    ).toBe("accepted the invitation for grace@example.com");
  });
});

describe("describeEvent on a delegation", () => {
  it("says what was finished, and quotes nothing", () => {
    // The tone belongs in the tone: an earlier version passed it where the
    // quotation goes, and the Activity read `finished … of this "agent"`.
    expect(describeEvent({ kind: "issue.children_closed", payload: { children: 6 } })).toEqual({
      text: "all 6 sub-issues of this are finished",
      detail: null,
      tone: "muted",
      routine: false,
    });
    expect(
      describeEvent({ kind: "issue.children_closed", payload: { children: 1 } }),
    ).toMatchObject({ text: "the sub-issue of this is finished", detail: null });
  });

  it("names the limit a fan-out hit, without quoting it", () => {
    expect(
      describeEvent({ kind: "delegation.refused", payload: { limit: "depth", allowed: 3 } }),
    ).toMatchObject({
      text: "could not open another sub-issue: sub-issues may not go deeper here (3)",
      detail: null,
    });
  });

  it("does not call a changed limit a rename", () => {
    expect(
      describeEvent({ kind: "workspace.updated", payload: { maxDelegationDepth: 5 } }),
    ).toMatchObject({ text: "set how far an Agent may split work up: 5 levels deep" });
    expect(describeEvent({ kind: "workspace.updated", payload: { to: "deevy" } })).toMatchObject({
      text: "renamed the Workspace to deevy",
    });
  });
});

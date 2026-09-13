import { describe, expect, it } from "vite-plus/test";
import { describeEvent } from "../src/lib/event-text.ts";

const ctx = {
  memberName: (id: string) => ({ "m-ada": "Ada", "m-bob": "Bob" })[id],
  labelName: (id: string) => ({ l1: "backend", l2: "epic: Checkout" })[id],
};

describe("describeEvent", () => {
  it("names the Gate and quotes the note on a ruling", () => {
    expect(
      describeEvent({
        kind: "gate.approved",
        payload: { state: "Intent", to: "Spec", note: "Go." },
      }),
    ).toMatchObject({
      text: "approved the Intent Gate → Spec",
      detail: "Go.",
      tone: "gate",
    });
    expect(
      describeEvent({
        kind: "gate.rejected",
        payload: { state: "Spec", to: "Intent", note: null },
      }),
    ).toMatchObject({
      text: "rejected the Spec Gate",
      detail: null,
      tone: "destructive",
    });
  });

  it("names the Labels, from the payload when it has them and from the map when it does not", () => {
    expect(
      describeEvent({
        kind: "issue.labels_changed",
        payload: {
          added: ["l1", "l2"],
          removed: [],
          addedNames: ["backend", "epic: Checkout"],
          removedNames: [],
        },
      })?.text,
    ).toBe("added Labels backend, epic: Checkout");
    expect(
      describeEvent({ kind: "issue.labels_changed", payload: { added: [], removed: ["l1"] } }, ctx)
        ?.text,
    ).toBe("removed the Label backend");
  });

  it("names the Assignee and the parent", () => {
    expect(
      describeEvent({ kind: "issue.assigned", payload: { from: "m-ada", to: "m-bob" } }, ctx)?.text,
    ).toBe("assigned it to Bob (was Ada)");
    expect(
      describeEvent({
        kind: "issue.assigned",
        payload: { from: null, to: "m-bob", toName: "Builder", byStateRule: true },
      })?.text,
    ).toBe("assigned it to Builder on entering the State");
    expect(
      describeEvent({ kind: "issue.assigned", payload: { from: "m-ada", to: null } }, ctx)?.text,
    ).toBe("unassigned it (was Ada)");
    expect(
      describeEvent({ kind: "issue.reparented", payload: { from: null, to: "x", toKey: "DEV-3" } })
        ?.text,
    ).toBe("set the parent to DEV-3");
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
    expect(
      describeEvent({
        kind: "document.updated",
        payload: { name: "spec", version: 3 },
        actorKind: "agent",
      }),
    ).toMatchObject({
      text: "wrote spec v3",
      routine: true,
    });
  });

  it("gives a comment the voice of whoever wrote it", () => {
    expect(
      describeEvent({ kind: "comment.created", payload: { commentId: "c1" }, actorKind: "agent" }),
    ).toMatchObject({ text: "commented", tone: "agent" });
    expect(
      describeEvent({ kind: "comment.edited", payload: { commentId: "c1" }, actorKind: "human" }),
    ).toMatchObject({ text: "edited a comment", tone: "human" });
    // No kind known: a Human's, as before.
    expect(describeEvent({ kind: "comment.deleted", payload: { commentId: "c1" } })).toMatchObject({
      text: "withdrew a comment",
      tone: "human",
    });
  });

  it("names the Gate a Run waits at when the Event carries it", () => {
    expect(
      describeEvent({
        kind: "run.awaiting_input",
        payload: { gateStateId: "s1", state: "Intent", url: "https://x" },
        actorKind: "agent",
      }),
    ).toMatchObject({ text: "is waiting at the Intent Gate", tone: "gate" });
    expect(
      describeEvent({ kind: "run.awaiting_input", payload: { gateStateId: "s1" } })?.text,
    ).toBe("is waiting at a Gate");
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

  it("reads the Workspace's own Events for the log", () => {
    expect(
      describeEvent({
        kind: "workflow.updated",
        payload: { states: ["Intent", "Build", "Done"], removed: 0 },
      })?.text,
    ).toBe("set the Workflow to Intent → Build → Done");
    expect(
      describeEvent({ kind: "agent.project_granted", payload: { projectKey: "DEV" } })?.text,
    ).toBe("granted DEV");
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

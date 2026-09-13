import { describe, expect, it } from "vite-plus/test";
import { describeNotification } from "../src/lib/notification-text.ts";

const issue = { state: { name: "Intent" } };

describe("describeNotification", () => {
  it("names the Gate and quotes the note on a ruling", () => {
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: {
          kind: "gate.rejected",
          payload: { state: "Spec", to: "Intent", note: "Not yet." },
        },
      }),
    ).toEqual({ verb: "rejected the Spec Gate", excerpt: "Not yet.", tone: "gate" });
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "gate.approved", payload: { state: "Intent", to: "Spec", note: null } },
      }).verb,
    ).toBe("approved the Intent Gate → Spec");
  });

  it("says which Gate an Issue arrived in", () => {
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "issue.moved", payload: { from: "Build", to: "Review" } },
      }).verb,
    ).toBe("moved it into the Review Gate");
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "issue.created", payload: {} },
      }).verb,
    ).toBe("created it in the Intent Gate");
  });

  it("names the Gate from the Event, not from where the Issue is now", () => {
    // The Issue has moved on to Intent; the Event remembers where it was created.
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "issue.created", payload: { key: "DEV-9", state: "Triage" } },
      }).verb,
    ).toBe("created it in the Triage Gate");
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "run.awaiting_input", payload: { gateStateId: "s2", state: "Review" } },
      }),
    ).toEqual({ verb: "is waiting at the Review Gate", excerpt: null, tone: "gate" });
    // Without the name, the Issue's current State is the best there is.
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "run.awaiting_input", payload: { gateStateId: "s2" } },
      }).verb,
    ).toBe("is waiting at the Intent Gate");
  });

  it("tells an Agent's Sponsor what was answered: a ruling by name, or a plain answer", () => {
    expect(
      describeNotification({
        kind: "run_answered",
        issue,
        event: {
          kind: "run.answered",
          payload: { gateStateId: "s1", ruling: "rejected", state: "Spec", note: "Not yet." },
        },
      }),
    ).toEqual({
      verb: "rejected the Spec Gate your Agent asked about",
      excerpt: "Not yet.",
      tone: "muted",
    });
    expect(
      describeNotification({
        kind: "run_answered",
        issue,
        event: { kind: "run.answered", payload: { ruling: "approved", state: "Spec" } },
      }).verb,
    ).toBe("approved the Spec Gate your Agent asked about");
    // A question answered is not a Gate decided.
    expect(
      describeNotification({
        kind: "run_answered",
        issue,
        event: { kind: "run.answered", payload: { activityId: "a1" } },
      }),
    ).toEqual({ verb: "answered your Agent's question", excerpt: null, tone: "muted" });
  });

  it("quotes the question, the summary and the comment", () => {
    expect(
      describeNotification({
        kind: "run_awaiting_input",
        issue,
        event: { kind: "run.awaiting_input", payload: { question: "Exponential or fixed?" } },
      }),
    ).toEqual({ verb: "asks a question", excerpt: "Exponential or fixed?", tone: "agent" });
    expect(
      describeNotification({
        kind: "run_finished",
        issue,
        event: { kind: "run.failed", payload: { summary: "Tests timed out." } },
      }),
    ).toEqual({ verb: "failed a Run", excerpt: "Tests timed out.", tone: "destructive" });
    expect(
      describeNotification({
        kind: "mention",
        issue,
        event: { kind: "comment.created", payload: { commentId: "c1" } },
        comment: { id: "c1", body: "@ada look" },
      }),
    ).toEqual({ verb: "mentioned you", excerpt: "@ada look", tone: "human" });
    expect(
      describeNotification({
        kind: "mention",
        issue,
        event: { kind: "comment.created", payload: { commentId: "c1" } },
        comment: { id: "c1", body: null },
      }).excerpt,
    ).toBe("(the comment was withdrawn)");
  });

  it("says when a State rule did the assigning", () => {
    expect(
      describeNotification({
        kind: "assignment",
        issue,
        event: { kind: "issue.assigned", payload: { to: "m", byStateRule: true } },
      }).verb,
    ).toBe("assigned it to you, entering Intent");
  });
});

describe("describeNotification on a wave of sub-issues", () => {
  it("does not claim a number it cannot know", () => {
    // The row is written when the first sub-issue is opened, so the size of the
    // wave does not exist yet. An earlier version read a payload field that was
    // never written and said "a sub-issue" however many there were.
    expect(
      describeNotification({
        kind: "delegation",
        issue,
        event: { kind: "issue.created", payload: { title: "Refund goes back to the card" } },
      }),
    ).toEqual({
      verb: "opened sub-issues under this",
      excerpt: "Refund goes back to the card",
      tone: "agent",
    });
  });

  it("says when they are all finished", () => {
    expect(
      describeNotification({
        kind: "delegation",
        issue,
        event: { kind: "issue.children_closed", payload: { children: 3 } },
      }),
    ).toEqual({ verb: "finished every sub-issue of this", excerpt: null, tone: "agent" });
  });
});

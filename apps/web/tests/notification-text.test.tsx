import { describe, expect, it } from "vite-plus/test";
import { describeNotification } from "../src/lib/notification-text.ts";

/** The record a row is about, as the tracker writes it (ADR-0024). */
const issue = { externalKey: "acme/deevy#42", title: "Refunds go back to the card" };

describe("describeNotification", () => {
  it("says whether a Human named you or deevy's routing did", () => {
    expect(
      describeNotification({
        kind: "assignment",
        issue,
        event: { kind: "issue.assigned", payload: { to: "m", byRouting: true } },
      }),
    ).toEqual({ verb: "routed it to you", excerpt: null, tone: "human" });
    expect(
      describeNotification({
        kind: "assignment",
        issue,
        event: { kind: "issue.assigned", payload: { to: "m" } },
      }).verb,
    ).toBe("assigned it to you");
  });

  it("says a Gate wants a ruling", () => {
    expect(
      describeNotification({
        kind: "gate_awaiting",
        issue,
        event: { kind: "run.awaiting_input", payload: {} },
      }),
    ).toEqual({ verb: "wants your ruling", excerpt: null, tone: "gate" });
  });

  it("tells an Agent's Sponsor what was answered: a ruling by name, or a plain answer", () => {
    expect(
      describeNotification({
        kind: "run_answered",
        issue,
        event: { kind: "run.answered", payload: { ruling: "rejected", note: "Not yet." } },
      }),
    ).toEqual({
      verb: "rejected the Gate your Agent asked about",
      excerpt: "Not yet.",
      tone: "muted",
    });
    expect(
      describeNotification({
        kind: "run_answered",
        issue,
        event: { kind: "run.answered", payload: { ruling: "approved" } },
      }).verb,
    ).toBe("approved the Gate your Agent asked about");
    // A question answered is not a Gate ruled on.
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

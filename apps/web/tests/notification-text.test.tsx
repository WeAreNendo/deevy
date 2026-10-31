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

  it("tells an Agent which way its Gate was ruled", () => {
    expect(
      describeNotification({
        kind: "run_answered",
        issue,
        event: { kind: "run.answered", payload: { decision: "rejected", note: "Not yet." } },
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
        event: { kind: "run.answered", payload: { decision: "approved" } },
      }).verb,
    ).toBe("approved the Gate your Agent asked about");
  });

  it("quotes the summary and the comment", () => {
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

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

describe("the Events a Socket causes", () => {
  it("says what a record arriving from a tracker means", () => {
    expect(describeEvent({ kind: "issue.created", payload: { key: "acme/deevy#42" } })?.text).toBe(
      "opened acme/deevy#42",
    );
    expect(
      describeEvent({ kind: "issue.synced", payload: { changed: ["title", "labels"] } })?.text,
    ).toBe("synced it from the tracker: title, labels");
    // Nothing worth naming still says something happened.
    expect(describeEvent({ kind: "issue.synced", payload: {} })?.text).toBe(
      "synced it from the tracker",
    );
    expect(describeEvent({ kind: "issue.closed", payload: {} })?.text).toBe(
      "closed it in the tracker",
    );
    expect(describeEvent({ kind: "issue.reopened", payload: {} })?.text).toBe(
      "reopened it in the tracker",
    );
  });

  it("names the tool a Socket connects, and what it is there", () => {
    expect(
      describeEvent({
        kind: "socket.connected",
        payload: { provider: "github", name: "Acme", login: "deevy" },
      })?.text,
    ).toBe("connected Acme, a github Socket, as @deevy");
    expect(describeEvent({ kind: "socket.removed", payload: { name: "Acme" } })?.text).toBe(
      "disconnected Acme",
    );
  });

  it("says a record was routed rather than assigned by hand", () => {
    expect(
      describeEvent({
        kind: "issue.assigned",
        payload: { from: null, to: "m-bob", toName: "Builder", byRouting: true },
      })?.text,
    ).toBe("routed it to Builder");
  });

  it("names the Project an Agent was granted by its slug", () => {
    expect(
      describeEvent({ kind: "agent.project_granted", payload: { projectSlug: "acme-deevy" } })
        ?.text,
    ).toBe("granted acme-deevy");
  });
});

/**
 * Convention 5 of docs/plans/sockets.md: a new EventKind has four consumers,
 * and this is the one that is checkable. The kinds are read out of the core's
 * own union rather than listed here, so a kind added there and forgotten here
 * fails rather than printing its dotted name at somebody in the Event log.
 */
describe("a Ruling made in the tracker", () => {
  it("says why one counted for nothing, as the reply in the tracker did", () => {
    expect(
      describeEvent({
        kind: "gate.ruling_refused",
        payload: { externalActor: "carol-gh", reason: "unknown_identity" },
      })?.text,
    ).toBe(
      "@carol-gh ruled from the tracker and it counted for nothing: an account nobody here has linked",
    );
    expect(
      describeEvent({
        kind: "gate.ruling_refused",
        payload: {
          externalActor: "ada",
          reason: "refused",
          message: "The ship Checkpoint wants somebody other than the Human this Run is for",
        },
      })?.text,
    ).toContain("wants somebody other than the Human this Run is for");
  });

  it("says how an account came to rule as somebody, and folds it away", () => {
    expect(
      describeEvent({
        kind: "identity.linked",
        payload: { login: "bob", instance: "github.com", verifiedBy: "sign_in" },
      }),
    ).toMatchObject({
      text: "linked @bob on github.com, from the account they sign in with",
      routine: true,
    });
    expect(
      describeEvent({ kind: "identity.revoked", payload: { login: "bob", instance: "github.com" } })
        ?.text,
    ).toBe("unlinked @bob on github.com");
  });
});

describe("every EventKind the core can append", () => {
  it("has a sentence, rather than falling through to its raw name", async () => {
    // Read as text by the bundler, so this needs no filesystem and no node types.
    const source = (await import("../../../packages/core/src/events.ts?raw")).default;
    const union = source.slice(
      source.indexOf("export type EventKind ="),
      source.indexOf("export type EventPayload"),
    );
    const kinds = [...union.matchAll(/\| "([a-z_]+\.[a-z_]+)"/g)].map((match) => match[1] ?? "");
    expect(kinds.length).toBeGreaterThan(20);

    const raw = kinds.filter((kind) => describeEvent({ kind, payload: {} })?.text === kind);
    expect(raw).toEqual([]);
  });
});

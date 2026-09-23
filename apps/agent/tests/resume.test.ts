import { describe, expect, it } from "vite-plus/test";
import { promptFor } from "../src/work.ts";
import type { Run } from "../src/deevy.ts";

/**
 * A Run stopped at a Gate and handed back when a Human rules on it.
 *
 * The walk itself — ask, wait, rule, resume — is the acceptance script's
 * (docs/sockets-acceptance.md); what is here is the half that is pure: the
 * prompt a resumed Run is given.
 */
describe("the prompt a resumed Run gets", () => {
  const run = {
    id: "run-1",
    issueKey: "acme/deevy#1",
    trigger: "assignment",
    status: "active",
  } as Run;

  it("says what happened while it was stopped, and nothing about how to work", () => {
    const approved = promptFor(run, {
      status: "approved",
      checkpoint: "plan",
      note: "go on",
      decidedByMemberId: "m1",
    });

    expect(approved).toContain("approved the plan Gate");
    expect(approved).toContain('They said: "go on"');
    // Everything else is in the instructions, which every session carries.
    expect(approved).not.toContain("runs_post_activity");
  });

  it("says nothing about a note nobody wrote", () => {
    const bare = promptFor(run, {
      status: "approved",
      checkpoint: "plan",
      note: null,
      decidedByMemberId: "m1",
    });

    expect(bare).not.toContain("They said");
  });
});

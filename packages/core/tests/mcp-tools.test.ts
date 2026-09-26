import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { toolManifest } from "../src/mcp/manifest.ts";
import { projectTools } from "../src/mcp/tools.ts";
import { router } from "../src/operations/index.ts";

describe("projecting operations to MCP tools", () => {
  it("takes only the operations that opt in, and names them so a client accepts them", () => {
    const tools = projectTools(router);

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    expect(tools.map((t) => t.name)).toContain("issues_get");
  });

  it("leaves out anything a Human must do in deevy's own UI", () => {
    const names = projectTools(router).map((t) => t.name);

    // A credential in a model's context is a credential in a transcript, so
    // the operation that answers with one is not projected at all (ADR-0014).
    expect(names).not.toContain("runs_checkout");
    expect(names).not.toContain("gates_approve");
    expect(names).not.toContain("gates_reject");
    expect(names).not.toContain("agents_create");
  });
});

describe("the committed tool manifest", () => {
  it("matches what the router projects, so CI catches a surface change", async () => {
    const snapshot = JSON.parse(
      await readFile(new URL("../mcp-tools.json", import.meta.url), "utf8"),
    ) as unknown;

    expect(await toolManifest()).toEqual(snapshot);
  });

  it("carries the tool set the Sockets cut leaves", async () => {
    const names = (await toolManifest()).map((tool) => tool.name);

    /*
     * Twenty, with `runs_report_usage`: what a session spent, reported by
     * whatever ran it, since deevy runs no Agent and so cannot count it
     * (docs/plans/run-usage.md). Nineteen, with `docs_get`: a Project's documents live in the team's own
     * tool, and this is how an Agent reads one (ADR-0024). Eighteen, now that deevy opens the pull request: `pulls_open` is a tool
     * and `runs_checkout` deliberately is not, because it answers with a
     * credential (ADR-0014). Seventeen when a Gate became a request on a Run: `runs_request_approval`
     * came back as `gates_request`, and `gates_get` beside it is the polling
     * half for a client that cannot take an elicitation, which is every client
     * today (mcp/elicitation.ts). The other fifteen are what the Sockets cut
     * left — the plan predicted thirteen and was counting the runtime's own
     * allowlist (docs/plans/sockets.md, slice 8), which is a different list.
     */
    expect(names).toEqual([
      // Socket-backed: it says something on the record where the record lives,
      // and what deevy keeps is the Event, because a mention is a trigger.
      "comments_create",
      // A page of the Project's documents, read where the team keeps them.
      "docs_get",
      // What an Agent asks when it reaches a Checkpoint, carrying the Proposal
      // a Human rules on, and how it reads the ruling when its client cannot
      // be handed a URL to open (ADR-0020, ADR-0024).
      "gates_get",
      "gates_request",
      "inbox_list",
      // Opens the record in the tracker the Project is bound to, which is how
      // an Agent cuts work up (ADR-0022, ADR-0024).
      "issues_create",
      "issues_get",
      "issues_list",
      "links_add",
      "links_list",
      // Removing one is bounded by the rule that an Agent may only take back
      // what its own Run attached (docs/plans/m3.md, slice 1).
      "links_remove",
      // Where an Agent learns what its Project is bound to.
      "projects_get",
      // Opening the pull request for the branch it pushed. deevy opens it, so
      // a Run's credential never has to be one that could.
      "pulls_open",
      // The Human side of a Run: answering an Agent's question from the
      // client the Human read it in. Not an Agent's, and the manifest says so.
      "runs_answer",
      "runs_finish",
      // Without it an Agent cannot read its own Activity feed, so a Human's
      // answer to a free-form elicitation never reaches the loop that asked.
      "runs_get",
      // Not in PLAN.md's list, and needed: an Agent whose Run a trigger opened
      // has no other way to find it, because it cannot learn its own Member id.
      // Its inbox does carry the assignment and the ruling it waits for, but
      // only `runs_list` answers once those have been read. Without this the
      // polling fallback ADR-0003 promises does not work (docs/plans/m2.md,
      // slice 9).
      "runs_list",
      "runs_post_activity",
      // What one session of the Run spent, by model. A tool so any client can
      // report, though the reference runtime's supervisor calls it over HTTP:
      // a model does not know what it cost, and is not asked.
      "runs_report_usage",
      "runs_start",
    ]);
  });

  it("keeps the inbox readable and its bookkeeping off the tool set", async () => {
    const names = (await toolManifest()).map((tool) => tool.name);

    // An Agent may clear its own inbox (docs/plans/m4.md, slice 1), and does it
    // over the HTTP API with the same key: the caller is the loop keeping its
    // own books rather than the model, so bookkeeping never grows the set.
    expect(names).toContain("inbox_list");
    expect(names).not.toContain("inbox_mark_read");
    expect(names).not.toContain("inbox_mark_all_read");
    expect(names).not.toContain("inbox_unread_count");
  });

  it("says which way each tool faces, so a client is offered only what it may call", async () => {
    const manifest = await toolManifest();
    const facing = (name: string) => manifest.find((tool) => tool.name === name);

    // The writing side of a Run is an Agent's alone: a Run is one Agent's
    // attempt on an Issue, and a Human is present for their own work (ADR-0016).
    for (const name of ["runs_start", "runs_post_activity", "runs_finish"]) {
      expect(facing(name)).toMatchObject({ agents: true, agentsOnly: true });
    }
    // Its reading side is anyone's, and answering is a Human's.
    expect(facing("runs_list")).toMatchObject({ agents: true, agentsOnly: false });
    expect(facing("runs_get")).toMatchObject({ agents: true, agentsOnly: false });
    expect(facing("runs_answer")).toMatchObject({ agents: false, agentsOnly: false });
    // Nothing is an Agent's alone without being an Agent's at all.
    for (const tool of manifest) if (tool.agentsOnly) expect(tool.agents).toBe(true);
  });

  it("keeps a Socket and a ruling off the tool set", async () => {
    const names = (await toolManifest()).map((tool) => tool.name);

    // Connecting a tool is an admin's, and it holds a credential (ADR-0024).
    expect(names).not.toContain("sockets_connect");
    expect(names).not.toContain("sockets_list");
    // A Gate is a Human's to rule on, whatever credential asks (ADR-0004,
    // ADR-0010). It is not a tool, and it does not become one in slice 2.
    // A credential in a model's context is a credential in a transcript, so
    // the operation that answers with one is not projected at all (ADR-0014).
    expect(names).not.toContain("runs_checkout");
    expect(names).not.toContain("gates_approve");
    expect(names).not.toContain("gates_reject");
  });
});

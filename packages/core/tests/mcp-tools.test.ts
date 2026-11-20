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

    // deevy hands out no credential and opens no pull request (ADR-0034).
    expect(names).not.toContain("runs_checkout");
    expect(names).not.toContain("pulls_open");
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
     * Fourteen, every one of them an Agent's, now that a Run waits only at a
     * Gate: a question is asked and answered on the record, in the tracker,
     * so there is nothing for a Human to answer here, and a Gate's answer is
     * the request itself rather than a URL elicitation to retry
     * (docs/plans/simplify.md, slice 5). Fifteen, now that the tracker is the Agent's to read and write with its
     * own access: deevy opens no record, writes no comment and reads no page
     * for it (docs/plans/simplify.md, slice 4). Eighteen, now that deevy takes no report of what a session spent: time
     * is what deevy saw itself, and a token count was only ever a client's
     * word (docs/plans/simplify.md, slice 3). Nineteen, now that deevy opens
     * no pull request: the Agent opens its own and hands it over with
     * `links_add` (ADR-0034). Twenty, with `runs_report_usage`: what a session
     * spent, reported by whatever ran it (docs/plans/run-usage.md). Nineteen,
     * with `docs_get`: a Project's documents live in the team's own
     * tool, and this is how an Agent reads one (ADR-0024). Eighteen, now that deevy opens the pull request: `pulls_open` is a tool
     * and `runs_checkout` deliberately is not, because it answers with a
     * credential (ADR-0014). Seventeen when a Gate became a request on a Run: `runs_request_approval`
     * came back as `gates_request`, and `gates_get` beside it is the polling
     * half for a client that cannot take an elicitation, which was every client
     * then. The other fifteen are what the Sockets cut
     * left — the plan predicted thirteen and was counting the runtime's own
     * allowlist (docs/plans/sockets.md, slice 8), which is a different list.
     */
    expect(names).toEqual([
      // What an Agent asks when it reaches a Checkpoint, carrying the Proposal
      // a Human rules on, and how it reads the ruling when its client cannot
      // be handed a URL to open (ADR-0020, ADR-0024).
      "gates_get",
      "gates_request",
      "inbox_list",
      "issues_get",
      "issues_list",
      "links_add",
      "links_list",
      // Removing one is bounded by the rule that an Agent may only take back
      // what its own Run attached (docs/plans/m3.md, slice 1).
      "links_remove",
      // Where an Agent learns what its Project is bound to.
      "projects_get",
      "runs_finish",
      // How an Agent reads its own Run: its status, its timing and the
      // Activities it posted.
      "runs_get",
      // Not in PLAN.md's list, and needed: an Agent whose Run a trigger opened
      // has no other way to find it, because it cannot learn its own Member id.
      // Its inbox does carry the assignment and the ruling it waits for, but
      // only `runs_list` answers once those have been read. Without this the
      // polling fallback ADR-0003 promises does not work (docs/plans/m2.md,
      // slice 9).
      "runs_list",
      "runs_post_activity",
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
    // Its reading side is anyone's.
    expect(facing("runs_list")).toMatchObject({ agents: true, agentsOnly: false });
    expect(facing("runs_get")).toMatchObject({ agents: true, agentsOnly: false });
    // And every tool is an Agent's, now that nothing is left for a Human to
    // answer from their own client (docs/plans/simplify.md, slice 5).
    for (const tool of manifest) expect(tool.agents).toBe(true);
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
    expect(names).not.toContain("runs_checkout");
    expect(names).not.toContain("gates_approve");
    expect(names).not.toContain("gates_reject");
  });
});

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

  it("carries the v1 tool set PLAN.md names", async () => {
    const names = (await toolManifest()).map((tool) => tool.name);

    expect(names).toEqual([
      "comments_create",
      "documents_get",
      "documents_write",
      // Added with live Documents (ADR-0021): the write an Agent usually
      // means, which merges by construction because the rest of the Document
      // is not in the payload.
      "documents_write_section",
      "inbox_list",
      "issues_create",
      "issues_get",
      "issues_list",
      // The one thing a Human working an Issue from their own client does
      // most, and an Agent's way to hand on an Issue it is done with. A Gate
      // is still left by a ruling and never by a move (ADR-0016).
      "issues_move",
      "issues_set_labels",
      "issues_update",
      "labels_create",
      "labels_list",
      "links_add",
      "links_list",
      // Removing one is bounded by the rule that an Agent may only take back
      // what its own Run attached (docs/plans/m3.md, slice 1).
      "links_remove",
      // Where `issues_move` learns a State's id, and which States are Gates.
      "projects_get",
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
      "runs_request_approval",
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
    for (const name of [
      "runs_start",
      "runs_post_activity",
      "runs_request_approval",
      "runs_finish",
    ]) {
      expect(facing(name)).toMatchObject({ agents: true, agentsOnly: true });
    }
    // Its reading side is anyone's, and answering is a Human's.
    expect(facing("runs_list")).toMatchObject({ agents: true, agentsOnly: false });
    expect(facing("runs_get")).toMatchObject({ agents: true, agentsOnly: false });
    expect(facing("runs_answer")).toMatchObject({ agents: false, agentsOnly: false });
    // Nothing is an Agent's alone without being an Agent's at all.
    for (const tool of manifest) if (tool.agentsOnly) expect(tool.agents).toBe(true);
  });

  it("widens Labels and Links no further than that", async () => {
    const names = (await toolManifest()).map((tool) => tool.name);

    // A Label is Workspace-scoped, so a granted Agent renaming or deleting one
    // reaches Projects it was never granted (docs/plans/m2.md), and a Gate is a
    // Human's to rule on. Creating a Label is additive, so it ships.
    expect(names).not.toContain("labels_update");
    expect(names).not.toContain("labels_delete");
    expect(names).not.toContain("gates_approve");
  });
});

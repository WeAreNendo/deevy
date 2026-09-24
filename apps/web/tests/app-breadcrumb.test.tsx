import { describe, expect, it } from "vite-plus/test";
import { crumbsFor } from "../src/components/app-breadcrumb.tsx";

const name = {
  member: (id: string) => ({ "m-1": "Planner" })[id],
};

describe("crumbsFor", () => {
  it("walks Settings to the page, and below it", () => {
    expect(crumbsFor("/settings/members", name).map((c) => c.label)).toEqual([
      "Settings",
      "Members",
    ]);
    // A detail page is named after the thing, never its id.
    expect(crumbsFor("/settings/agents/m-1", name).map((c) => c.label)).toEqual([
      "Settings",
      "Agents",
      "Planner",
    ]);
    expect(crumbsFor("/settings/agents/unknown", name).map((c) => c.label)).toEqual([
      "Settings",
      "Agents",
      "Unknown",
    ]);
  });

  it("names the Inbox, which is a place of deevy's own", () => {
    expect(crumbsFor("/inbox", name).map((c) => c.label)).toEqual(["Inbox"]);
  });

  it("walks the three places deevy still keeps: Runs, Work and a Gate", () => {
    expect(crumbsFor("/runs", name).map((c) => c.label)).toEqual(["Runs"]);
    // One Run is under the feed it came from, named by its id: a Run has no
    // name of its own, and the record's key is on the page itself.
    expect(crumbsFor("/runs/run_abc123", name)).toEqual([
      { label: "Runs", to: "/runs" },
      { label: "run_abc123" },
    ]);
    expect(crumbsFor("/work/iss_abc123", name)).toEqual([
      { label: "Work", to: "/work" },
      { label: "iss_abc123" },
    ]);
    // A Gate is not under anything: it is the link an Agent hands a Human,
    // and the trail above it would be a page they never came from.
    expect(crumbsFor("/gates/gate_abc123", name).map((c) => c.label)).toEqual(["Gate"]);
  });
});

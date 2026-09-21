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
});

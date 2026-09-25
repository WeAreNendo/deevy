import { describe, expect, it } from "vite-plus/test";
import { crumbsFor } from "../src/components/app-breadcrumb.tsx";

const name = {
  member: (id: string) => ({ "m-1": "Planner" })[id],
  socket: (id: string) => ({ sock_abc123: "acme on GitHub" })[id],
  record: (id: string) => ({ iss_abc123: "acme/deevy#42" })[id],
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
    // A Socket too: the first real GitHub walk read "Sock_j6hz8u2ad9as" here.
    expect(crumbsFor("/settings/sockets/sock_abc123", name).map((c) => c.label)).toEqual([
      "Settings",
      "Sockets",
      "acme on GitHub",
    ]);
  });

  it("names the Inbox, which is a place of deevy's own", () => {
    expect(crumbsFor("/inbox", name).map((c) => c.label)).toEqual(["Inbox"]);
  });

  it("walks the three places deevy still keeps: Runs, Work and a Gate", () => {
    expect(crumbsFor("/runs", name).map((c) => c.label)).toEqual(["Runs"]);
    // One Run is under the feed it came from, named by its id: a Run has no
    // name of its own, and its id is what every comment it signs says.
    expect(crumbsFor("/runs/run_abc123", name)).toEqual([
      { label: "Runs", to: "/runs" },
      { label: "run_abc123" },
    ]);
    // A record is named by its tracker's key, which a Human recognises; its
    // id only until the record has been read.
    expect(crumbsFor("/work/iss_abc123", name)).toEqual([
      { label: "Work", to: "/work" },
      { label: "acme/deevy#42" },
    ]);
    expect(crumbsFor("/work/iss_unread", name)).toEqual([
      { label: "Work", to: "/work" },
      { label: "iss_unread" },
    ]);
    // A Gate is not under anything: it is the link an Agent hands a Human,
    // and the trail above it would be a page they never came from.
    expect(crumbsFor("/gates/gate_abc123", name).map((c) => c.label)).toEqual(["Gate"]);
  });
});

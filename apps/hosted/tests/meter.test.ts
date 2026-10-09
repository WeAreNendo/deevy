import { describe, expect, it } from "vite-plus/test";
import { kindOf, meter, type Meter } from "../src/meter.ts";

describe("a request's data point", () => {
  it("names the Workspace and what kind of request it was, and nothing personal", () => {
    expect(kindOf("/acme/rpc/gates/list")).toEqual({ slug: "acme", kind: "app" });
    expect(kindOf("/acme/gates/gate_1")).toEqual({ slug: "acme", kind: "page" });
    expect(kindOf("/acme/api/live")).toEqual({ slug: "acme", kind: "live" });
    expect(kindOf("/.well-known/oauth-authorization-server/acme")).toEqual({
      slug: "acme",
      kind: "discovery",
    });
    expect(kindOf("/auth/callback/github")).toEqual({ slug: "", kind: "relay" });
    expect(kindOf("/")).toEqual({ slug: "", kind: "console" });
    expect(kindOf("/workspaces")).toEqual({ slug: "", kind: "console" });

    const points: unknown[] = [];
    const dataset: Meter = { writeDataPoint: (point) => points.push(point) };
    meter(
      dataset,
      new Request("https://app.example.com/acme/rpc/me/get?email=ada@example.com"),
      new Response(null, { status: 401 }),
      12,
    );
    expect(points).toEqual([{ indexes: ["acme"], blobs: ["app", "GET", "401"], doubles: [12, 1] }]);
    expect(JSON.stringify(points)).not.toContain("ada");
  });

  it("never fails the request it measures", () => {
    const broken: Meter = {
      writeDataPoint: () => {
        throw new Error("the dataset is down");
      },
    };
    expect(() =>
      meter(broken, new Request("https://app.example.com/acme/"), new Response(), 1),
    ).not.toThrow();
    expect(() =>
      meter(undefined, new Request("https://app.example.com/acme/"), new Response(), 1),
    ).not.toThrow();
  });
});

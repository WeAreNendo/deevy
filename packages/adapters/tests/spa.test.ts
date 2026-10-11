import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  APP_PATHS,
  APP_PREFIXES,
  isAppPath,
  serveSpaUnder,
  underBase,
  withBaseHref,
} from "../src/spa.ts";

describe("the SPA under a path", () => {
  it("rewrites the index's base element, and leaves the root's alone", () => {
    const index = '<head><base href="/" /><link href="favicon.svg"></head>';
    expect(withBaseHref(index, "/acme")).toBe(
      '<head><base href="/acme/" /><link href="favicon.svg"></head>',
    );
    expect(withBaseHref(index, "")).toBe(index);
    // What a path could smuggle into an attribute is dropped.
    expect(withBaseHref(index, '/a"><script>')).toContain('<base href="/ascript/" />');
  });

  it("knows what is under the base, and what the app answers", () => {
    expect(underBase("/acme/assets/x.js", "/acme")).toBe("/assets/x.js");
    expect(underBase("/acme", "/acme")).toBe("/");
    expect(underBase("/acme-corp/x", "/acme")).toBeNull();
    expect(underBase("/other", "/acme")).toBeNull();
    expect(underBase("/anything", "")).toBe("/anything");

    for (const path of ["/api/health/ping", "/rpc/x", "/mcp", "/hooks/sock_1", "/healthz"]) {
      expect(isAppPath(path)).toBe(true);
    }
    for (const path of ["/", "/gates/gate_1", "/assets/x.js", "/mcp-clients"]) {
      expect(isAppPath(path)).toBe(false);
    }
  });

  it("serves a file from the root of the store, and the index rewritten for every route", async () => {
    const asked: string[] = [];
    const assets = {
      async fetch(request: Request) {
        const { pathname } = new URL(request.url);
        asked.push(pathname);
        if (pathname === "/assets/x.js") {
          return new Response("console.log(1)", { headers: { "content-type": "text/javascript" } });
        }
        return new Response('<base href="/" />', {
          headers: { "content-type": "text/html", etag: '"v1"', "content-length": "17" },
        });
      },
    };
    const file = await serveSpaUnder(new Request("https://x/acme/assets/x.js"), "/acme", assets);
    expect(await file?.text()).toBe("console.log(1)");

    const page = await serveSpaUnder(new Request("https://x/acme/gates/gate_1"), "/acme", assets);
    expect(await page?.text()).toBe('<base href="/acme/" />');
    expect(page?.headers.get("cache-control")).toBe("no-cache");
    expect(page?.headers.get("etag")).toBeNull();
    expect(asked).toEqual(["/assets/x.js", "/gates/gate_1"]);

    expect(await serveSpaUnder(new Request("https://x/other"), "/acme", assets)).toBeNull();
  });

  /**
   * The Worker at the root of a host routes the same paths to the app with
   * `run_worker_first`, which packages/core/tests/worker-routes.test.ts holds
   * against `createApp`; under a path it asks `isAppPath`. One list, written
   * twice, so this says they are the same.
   */
  it("names the same paths as the Worker's run_worker_first", async () => {
    const config = await readFile(
      new URL("../../../apps/web/wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const rules = JSON.parse(
      /"run_worker_first":\s*(\[[^\]]*\])/.exec(config)?.[1] ?? "[]",
    ) as string[];
    const ours = [...APP_PREFIXES.map((prefix) => `${prefix}*`), ...APP_PATHS];
    expect([...rules].sort()).toEqual([...ours].sort());
  });
});

import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { App } from "../src/app.ts";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * The instance a Worker serves. Auth is present although the Worker has none
 * until slice 5: the routing table has to carry every path the app can mount,
 * and `/api/auth/*` and the `.well-known` documents only exist with it.
 */
function testApp(): App {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL: "https://deevy.example.com",
      secret: "test-secret-that-is-at-least-32-characters",
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  return createApp({ db, auth, baseURL: "https://deevy.example.com" });
}

/** A path a request could actually carry, from one of Hono's route patterns. */
function requestPath(pattern: string): string {
  return pattern.replace(/:[^/]+/g, "sample").replace(/\*/g, "deep/path");
}

/**
 * Cloudflare matches an `assets.run_worker_first` rule against the request
 * path, `*` spanning as many segments as it likes, and a leading `!` excluding
 * what it matches.
 */
function ruleMatches(rule: string, path: string): boolean {
  const glob = rule.startsWith("!") ? rule.slice(1) : rule;
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(path);
}

/**
 * The paths the app answers that the asset handler would answer first. On
 * Cloudflare these come back as the SPA's index.html: a 200 with the wrong
 * body, which no test of createApp can see (docs/plans/m3.md slice 4). Every
 * path here is one createApp mounts, and createApp mounts nothing the SPA
 * owns — the SPA's own routes are the asset handler's, and Node adds them to
 * the app after the fact (apps/server/src/server.ts).
 */
function servedByTheAssetHandler(app: App, runWorkerFirst: string[]): string[] {
  const excluded = runWorkerFirst.filter((rule) => rule.startsWith("!"));
  const included = runWorkerFirst.filter((rule) => !rule.startsWith("!"));
  const paths = [...new Set(app.routes.map((route) => route.path))];
  return paths.filter((route) => {
    const path = requestPath(route);
    return (
      !included.some((rule) => ruleMatches(rule, path)) ||
      excluded.some((rule) => ruleMatches(rule, path))
    );
  });
}

/** `assets.run_worker_first` from the committed Worker configuration. */
async function runWorkerFirst(): Promise<string[]> {
  const source = await readFile(
    new URL("../../../apps/web/wrangler.jsonc", import.meta.url),
    "utf8",
  );
  const config = JSON.parse(stripJsonc(source)) as { assets?: { run_worker_first?: unknown } };
  const rules = config.assets?.run_worker_first;
  if (!Array.isArray(rules)) throw new Error("wrangler.jsonc has no run_worker_first list");
  return rules as string[];
}

/** Enough of JSONC to read wrangler's config: comments and trailing commas. */
function stripJsonc(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      out += char;
      if (char === "\\") out += source[++i] ?? "";
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

describe("the Worker's routing table", () => {
  it("routes every path createApp mounts to the Worker rather than the assets", async () => {
    expect(servedByTheAssetHandler(testApp(), await runWorkerFirst())).toEqual([]);
  });

  it("catches a route the app grows without a rule to carry it", async () => {
    const app = testApp();
    app.get("/metrics", (c) => c.json({ ok: true }));

    expect(servedByTheAssetHandler(app, await runWorkerFirst())).toEqual(["/metrics"]);
  });

  // A rule that takes a path back off the Worker covers nothing, so a list
  // that grows one may not read as green here.
  it("counts a path an exclusion rule takes back off the Worker", () => {
    expect(servedByTheAssetHandler(testApp(), ["/*", "!/mcp"])).toEqual(["/mcp"]);
  });
});

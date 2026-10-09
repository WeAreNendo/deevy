import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { SCALAR_SCRIPT, dataHeaders, docsPolicy, pageHeaders, pagePolicy } from "../src/headers.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function testApp() {
  const { db, close } = testDb();
  closers.push(close);
  return createApp({ db, secret: "test-secret-that-is-at-least-32-characters" });
}

/** One directive of a policy, by name: its sources, or null when it has none. */
function directive(policy: string, name: string): string[] | null {
  for (const part of policy.split(";")) {
    const [key, ...sources] = part.trim().split(/\s+/);
    if (key === name) return sources;
  }
  return null;
}

/** The headers a Cloudflare `_headers` file gives one path, as written. */
function headersFileRule(source: string, path: string): Record<string, string> {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const line of source.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = {};
      rules.set(line.trim(), current);
      continue;
    }
    const at = line.indexOf(":");
    if (current && at > 0) current[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules.get(path) ?? {};
}

describe("a page's policy", () => {
  it("runs only scripts from deevy's own origin: nothing inline, no eval, no CDN", () => {
    expect(directive(pagePolicy, "script-src")).toEqual(["'self'"]);
    expect(directive(pagePolicy, "default-src")).toEqual(["'self'"]);
    expect(directive(pagePolicy, "object-src")).toEqual(["'none'"]);
    expect(directive(pagePolicy, "base-uri")).toEqual(["'none'"]);
  });

  it("lets nothing frame a page, so a Gate's Approve cannot be clicked through one", () => {
    expect(directive(pagePolicy, "frame-ancestors")).toEqual(["'none'"]);
    expect(pageHeaders["X-Frame-Options"]).toBe("DENY");
  });

  /**
   * The asset handler answers the SPA on a Worker before any code of deevy's
   * runs, so its headers are a file; this is what keeps the file and the
   * Node server saying the same thing.
   */
  it("is what the Worker's asset handler serves the SPA with", async () => {
    const source = await readFile(
      new URL("../../../apps/web/public/_headers", import.meta.url),
      "utf8",
    );

    expect(headersFileRule(source, "/*")).toEqual(pageHeaders);
  });
});

describe("createApp's responses", () => {
  it("send a page the server writes itself with the page's headers", async () => {
    // An unsubscribe link that was changed on the way: a page, written here.
    const res = await testApp().request("/api/email/unsubscribe/not-a-token");

    expect(res.headers.get("content-type")).toContain("text/html");
    for (const [name, value] of Object.entries(pageHeaders)) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });

  it("send a route added after the fact the same way: the SPA on Node", async () => {
    const app = testApp();
    app.get("*", (c) => c.html("<!doctype html><title>deevy</title><div id=root></div>"));

    const res = await app.request("/gates/gate_abc123def456");

    expect(res.headers.get("content-security-policy")).toBe(pagePolicy);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("send everything that is not a page as something never to render", async () => {
    const res = await testApp().request("/api/health/ping");

    expect(res.headers.get("content-type")).toContain("application/json");
    for (const [name, value] of Object.entries(dataHeaders)) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });

  it("leave a header a handler chose alone", async () => {
    const app = testApp();
    app.get("/framed", (c) => c.text("ok", 200, { "X-Frame-Options": "SAMEORIGIN" }));

    expect((await app.request("/framed")).headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe("the API reference page", () => {
  /**
   * The one page that runs a script from somewhere else: Scalar, from
   * jsDelivr, and the inline script that hands it the document. It names
   * both, the inline one by its hash, and still nothing else may run.
   */
  it("runs Scalar and its own inline script, and nothing else", async () => {
    const res = await testApp().request("/api/docs");
    const html = await res.text();
    const policy = res.headers.get("content-security-policy") ?? "";

    expect(html).toContain(`<script src="${SCALAR_SCRIPT}">`);
    expect(policy).toBe(await docsPolicy(html));
    const scripts = directive(policy, "script-src") ?? [];
    expect(scripts[0]).toBe(SCALAR_SCRIPT);
    expect(scripts.slice(1)).toEqual([expect.stringMatching(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/)]);
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
  });

  it("hashes the inline script it serves, so a different one would not run", async () => {
    const policy = await docsPolicy("<script>Scalar.createApiReference('#app', {})</script>");
    const other = await docsPolicy("<script>alert(document.cookie)</script>");

    expect(directive(policy, "script-src")).not.toEqual(directive(other, "script-src"));
  });
});

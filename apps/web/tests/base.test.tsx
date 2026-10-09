import { afterEach, describe, expect, it } from "vite-plus/test";
import { appURL, basePath, inApp, withBase } from "@/lib/base";
import { invitationInPath } from "@/lib/invitation";

/**
 * The page says where this deevy lives in its `<base href>`, which the server
 * writes (docs/plans/hosted.md): everything the SPA calls or links to follows
 * it, and a page with none is at the root.
 */
function servedUnder(href: string) {
  const base = document.createElement("base");
  base.setAttribute("href", href);
  document.head.prepend(base);
}

afterEach(() => {
  document.querySelectorAll("base").forEach((element) => element.remove());
});

describe("the path this deevy lives under", () => {
  it("is the root when the page names none", () => {
    expect(basePath()).toBe("");
    expect(withBase("/rpc")).toBe("/rpc");
    expect(appURL("/mcp")).toBe(`${window.location.origin}/mcp`);
    expect(inApp("/invite/abc")).toBe("/invite/abc");
  });

  it("is the root when the page names the root", () => {
    servedUnder("/");
    expect(basePath()).toBe("");
    expect(withBase("/api/auth")).toBe("/api/auth");
  });

  it("puts every call and link under the path the page names", () => {
    servedUnder("/acme/");
    expect(basePath()).toBe("/acme");
    expect(withBase("/rpc")).toBe("/acme/rpc");
    expect(withBase("/api/auth")).toBe("/acme/api/auth");
    expect(appURL("/mcp")).toBe(`${window.location.origin}/acme/mcp`);
    expect(appURL("")).toBe(`${window.location.origin}/acme`);
    // An invitation's link is the same path, under this deevy.
    expect(invitationInPath(inApp("/acme/invite/tok_123"))).toBe("tok_123");
    expect(inApp("/acme")).toBe("/");
    expect(inApp("/elsewhere")).toBe("/elsewhere");
  });
});

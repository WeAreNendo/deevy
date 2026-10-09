import { describe, expect, it } from "vite-plus/test";
import { webHref } from "../src/lib/href.ts";

describe("webHref", () => {
  it("keeps a web page's address as it was given", () => {
    expect(webHref("https://github.com/acme/deevy/pull/7")).toBe(
      "https://github.com/acme/deevy/pull/7",
    );
    expect(webHref("http://gitlab.internal/acme/-/issues/1")).toBe(
      "http://gitlab.internal/acme/-/issues/1",
    );
  });

  /**
   * The browser reads an `href` the way `URL` does — case folded, tabs and
   * newlines dropped, leading spaces trimmed — so each of these is a script
   * to it, and must be one here too.
   */
  it("draws nothing for an address that would run or render something", () => {
    for (const url of [
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "/relative/path",
      "",
      null,
      undefined,
    ]) {
      expect(webHref(url), String(url)).toBeUndefined();
    }
  });
});

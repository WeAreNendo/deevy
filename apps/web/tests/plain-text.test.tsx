import { describe, expect, it } from "vite-plus/test";
import { plainLine } from "../src/lib/plain-text.ts";

/**
 * Markdown as one line of words, for a place that quotes a Proposal or a
 * comment rather than rendering it: an Inbox row, a Run's feed. Without it a
 * Proposal read "## What I will do Read `/approve` and …".
 */
describe("a line of words out of markdown", () => {
  it("keeps the words and drops the marks", () => {
    expect(
      plainLine(
        "## What I will do\n\nRead `/approve` and **reject** off a [comment](https://example.com), _then_:\n\n- one\n- two\n1. three\n> quoted",
      ),
    ).toBe("What I will do Read /approve and reject off a comment, then: one two three quoted");
  });

  it("keeps a code block's contents and names that look like emphasis", () => {
    expect(plainLine("Run\n```bash\nvp run -r test\n```\nin snake_case_names")).toBe(
      "Run vp run -r test in snake_case_names",
    );
  });

  it("says an image by what it is of", () => {
    expect(plainLine("See ![the board](https://example.com/b.png) here")).toBe(
      "See the board here",
    );
  });
});

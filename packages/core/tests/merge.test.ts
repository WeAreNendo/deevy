import { describe, expect, it } from "vite-plus/test";
import { mergeMarkdown } from "../src/merge.ts";

/**
 * The three-way merge an Agent's write goes through (ADR-0021). `base` is what
 * the Agent read, `mine` is what it wrote, `theirs` is what the Document says
 * now — and what lands is what the Agent *changed*, replayed onto the live
 * text, rather than the whole body pasted over somebody's paragraph.
 */
const SPEC = [
  "## Requirements",
  "",
  "1. A Checkout is one server-side object.",
  "2. Every payment attempt carries an idempotency key.",
  "",
  "## Design",
  "",
  "`checkout.create` opens the object.",
  "",
  "## Concerns",
  "",
  "- Guest checkout is still open from the intent.",
].join("\n");

describe("an Agent's write, merged", () => {
  it("keeps the Human's paragraph and the Agent's, when they touched different ones", () => {
    const mine = SPEC.replace(
      "`checkout.create` opens the object.",
      "`checkout.create` opens it and returns its id.",
    );
    const theirs = SPEC.replace(
      "- Guest checkout is still open from the intent.",
      "- Guest checkout is settled: an account is the price of buying.",
    );

    const merged = mergeMarkdown({ base: SPEC, mine, theirs });

    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.text).toContain("opens it and returns its id.");
    expect(merged.text).toContain("an account is the price of buying.");
  });

  it("refuses when both of them rewrote the same lines, and says where", () => {
    const mine = SPEC.replace(
      "2. Every payment attempt carries an idempotency key.",
      "2. Every payment attempt carries a key derived from the Checkout id.",
    );
    const theirs = SPEC.replace(
      "2. Every payment attempt carries an idempotency key.",
      "2. Every payment attempt is idempotent within 24 hours.",
    );

    const merged = mergeMarkdown({ base: SPEC, mine, theirs });

    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    // Named by the heading it falls under, because "line 4" means nothing to
    // an Agent that is about to re-read the Document.
    expect(merged.clashed).toEqual(["## Requirements"]);
  });

  it("applies a whole rewrite when nobody else touched it", () => {
    const mine = "## Requirements\n\nOne sentence instead of all that.";

    const merged = mergeMarkdown({ base: SPEC, mine, theirs: SPEC });

    expect(merged).toEqual({ ok: true, text: mine });
  });

  it("changes nothing when the Agent wrote what was already there", () => {
    const theirs = SPEC.replace("## Design", "## How");

    const merged = mergeMarkdown({ base: SPEC, mine: SPEC, theirs });

    expect(merged).toEqual({ ok: true, text: theirs });
  });

  it("takes the Agent's text when the Document is untouched and there is no base", () => {
    // No basis and no version to compare: a write with nothing to merge
    // against is the write, which is what `documents.write` has always done.
    const merged = mergeMarkdown({ base: null, mine: "Fresh.", theirs: SPEC });

    expect(merged).toEqual({ ok: true, text: "Fresh." });
  });

  it("names the top of the Document when the clash is above any heading", () => {
    const base = "A first line.\n\n## Later\n\nSomething.";
    const mine = base.replace("A first line.", "The Agent's first line.");
    const theirs = base.replace("A first line.", "A Human's first line.");

    const merged = mergeMarkdown({ base, mine, theirs });

    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.clashed).toEqual(["the top of the Document"]);
  });
});

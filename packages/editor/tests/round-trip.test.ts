import * as Y from "yjs";
import { describe, expect, it } from "vite-plus/test";
import { loadMarkdown, markdownOf } from "../src/index.ts";

/** Markdown in, a live document, markdown out: what a version is made of. */
function through(markdown: string): string {
  const doc = new Y.Doc();
  loadMarkdown(doc, markdown);
  return markdownOf(doc);
}

describe("a Document as a room holds it", () => {
  it("keeps the shapes a Document is written in", () => {
    for (const markdown of [
      "## Problem\n\nCheckout is four screens.",
      "- one\n- two\n- three",
      "1. first\n2. second",
      "> a quote",
      "`inline code` and **bold** and *italic*",
      "```ts\nconst a = 1;\n```",
      "A [link](https://deevy.test) in a sentence.",
      "---",
    ]) {
      expect(through(markdown)).toBe(markdown);
    }
  });

  it("is empty when there is nothing in it", () => {
    expect(markdownOf(new Y.Doc())).toBe("");
    expect(through("")).toBe("");
  });

  it("carries what two Members typed into one Document", () => {
    // The whole point of the room: two replicas, merged, serialised once.
    const ada = new Y.Doc();
    loadMarkdown(ada, "## Problem\n\nCheckout is four screens.");

    const grace = new Y.Doc();
    Y.applyUpdate(grace, Y.encodeStateAsUpdate(ada));

    // Each of them writes a paragraph the other has not seen.
    const intoAda = new Y.Doc();
    Y.applyUpdate(intoAda, Y.encodeStateAsUpdate(ada));
    loadMarkdown(intoAda, "## Problem\n\nCheckout is four screens.\n\nAda's line.");

    Y.applyUpdate(ada, Y.encodeStateAsUpdate(intoAda));
    Y.applyUpdate(grace, Y.encodeStateAsUpdate(ada));

    expect(markdownOf(grace)).toBe(markdownOf(ada));
    expect(markdownOf(grace)).toContain("Ada's line.");
  });

  it("changes nothing when the markdown it is given is the markdown it has", () => {
    // Loading is how an Agent's write reaches a live room, so a write that
    // changes nothing must leave the document — and its history — alone.
    const doc = new Y.Doc();
    loadMarkdown(doc, "## Problem\n\nOne line.");
    const before = Y.encodeStateAsUpdate(doc).length;

    loadMarkdown(doc, "## Problem\n\nOne line.");

    expect(markdownOf(doc)).toBe("## Problem\n\nOne line.");
    expect(Y.encodeStateAsUpdate(doc).length).toBe(before);
  });
});

/**
 * A room is rebuilt from markdown whenever there is no state to open it with —
 * a server restarted, a Durable Object evicted, a blob lost. A browser that was
 * in the room when that happened still holds its own copy, and the two are
 * merged the moment it reconnects.
 *
 * Two documents built independently from the same text are, to Yjs, two
 * different pieces of writing that happen to read alike, and merging them
 * appends one to the other. That is how an Issue's description quietly becomes
 * four copies of itself. So a rebuild is made to depend on nothing but the text
 * (ADR-0021).
 */
describe("a room rebuilt from what a Document says", () => {
  const DESCRIPTION =
    "The Checkout flow is three Projects' worth of Issues.\n\n## Why now\n\nEvery Run ends in a question.";

  function rebuilt(markdown: string): Y.Doc {
    const doc = new Y.Doc();
    loadMarkdown(doc, markdown);
    return doc;
  }

  it("comes out the same both times, so reconnecting is not a second copy", () => {
    const server = rebuilt(DESCRIPTION);
    const browser = rebuilt(DESCRIPTION);

    Y.applyUpdate(browser, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(browser));

    expect(markdownOf(browser)).toBe(DESCRIPTION);
    expect(markdownOf(server)).toBe(DESCRIPTION);
  });

  it("survives being rebuilt over and over, which is what a restart does", () => {
    const browser = rebuilt(DESCRIPTION);
    for (let restart = 0; restart < 4; restart++) {
      Y.applyUpdate(browser, Y.encodeStateAsUpdate(rebuilt(DESCRIPTION)));
    }
    expect(markdownOf(browser)).toBe(DESCRIPTION);
  });

  it("keeps what somebody typed while the room was being rebuilt", () => {
    const browser = rebuilt(DESCRIPTION);
    loadMarkdown(browser, `${DESCRIPTION}\n\n## Later\n\nTyped while it was down.`);

    Y.applyUpdate(browser, Y.encodeStateAsUpdate(rebuilt(DESCRIPTION)));

    expect(markdownOf(browser)).toContain("Typed while it was down.");
    // And the description it was typed under is still there once.
    expect(markdownOf(browser).match(/Every Run ends in a question\./g)).toHaveLength(1);
  });
});

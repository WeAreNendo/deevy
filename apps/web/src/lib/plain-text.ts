/**
 * Markdown as one line of words (docs/plans/sockets.md).
 *
 * A Proposal, a comment and an Agent's Activity are markdown, and most places
 * render them. A few quote one instead — an Inbox row, a line of a Run's feed —
 * and there the marks are noise: `## What I will do` is a heading on the Gate
 * page and two hashes in a quote. This keeps the words and drops the marks,
 * without pretending to parse markdown: a quote is a hint, and the Gate page is
 * where the Proposal is read.
 */
export function plainLine(markdown: string): string {
  return (
    markdown
      // A fence's own lines go, and what it held stays.
      .replace(/^\s*```.*$/gm, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      // Single marks only where they wrap a word, so snake_case stays itself.
      .replace(/(^|[^\w*])[*_]([^*_\n]+?)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

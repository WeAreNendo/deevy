/**
 * The Markdown the docs sync rewrites, as text. A parser would hand back a tree
 * and lose the source's own spacing; the sync only ever changes a link's
 * destination, a heading's level and an ADR number into a link, so it works on
 * the text and leaves everything else byte for byte as the repository has it.
 *
 * What it must never touch is code: a fenced block, or an inline span, which in
 * these documents is full of `#` comments, `[x](y)`-shaped shell and ADR
 * numbers that are meant literally.
 */
import GithubSlugger from "github-slugger";

/** A run of a document that is either fenced code, kept as it is, or anything else. */
export interface Block {
  code: boolean;
  text: string;
}

const fenceOpen = /^[ \t]*(`{3,}|~{3,})/;

/** Splits a document into fenced code blocks and the text between them. */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  const lines = markdown.split("\n");
  let current: string[] = [];
  let fence: string | null = null;
  const flush = (code: boolean) => {
    if (current.length > 0) out.push({ code, text: current.join("\n") });
    current = [];
  };
  for (const line of lines) {
    if (fence === null) {
      const open = fenceOpen.exec(line);
      if (open) {
        flush(false);
        fence = open[1];
      }
      current.push(line);
    } else {
      current.push(line);
      const close = new RegExp(`^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) {
        flush(true);
        fence = null;
      }
    }
  }
  // An unclosed fence runs to the end of the document, as CommonMark has it.
  flush(fence !== null);
  // Joined back with the newline each split took away.
  return out.map((block, i) =>
    i < out.length - 1 ? { ...block, text: `${block.text}\n` } : block,
  );
}

/**
 * The text with every inline code span replaced by a mask of the same length,
 * so a pattern run over it cannot match inside code and every offset it finds
 * is an offset into the original. A span may wrap onto the next line but never
 * across a blank one.
 */
export function maskCode(text: string): string {
  // UTF-16 units rather than code points, so that offsets agree with the original's.
  const chars = text.split("");
  const run = (at: number) => {
    let n = 0;
    while (chars[at + n] === "`") n++;
    return n;
  };
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === "\\") {
      i += 2;
      continue;
    }
    if (chars[i] !== "`") {
      i++;
      continue;
    }
    const open = run(i);
    let j = i + open;
    let close = -1;
    while (j < chars.length) {
      if (chars[j] === "`") {
        const length = run(j);
        if (length === open) {
          close = j;
          break;
        }
        j += length;
        continue;
      }
      if (chars[j] === "\n" && /^\n[ \t]*\n/.test(chars.slice(j, j + 80).join(""))) break;
      j++;
    }
    if (close < 0) {
      i += open;
      continue;
    }
    for (let k = i; k < close + open; k++) if (chars[k] !== "\n") chars[k] = "\u0000";
    i = close + open;
  }
  return chars.join("");
}

/** A heading outside code: its level, its text as written, and where its line starts. */
export interface Heading {
  depth: number;
  text: string;
  offset: number;
}

const headingLine = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

export function headings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let offset = 0;
  for (const block of blocks(markdown)) {
    if (!block.code) {
      // Matched on the masked text, so a line inside a wrapped code span is not
      // taken for a heading; the text is the original's.
      const masked = maskCode(block.text);
      let at = 0;
      for (const line of masked.split("\n")) {
        const match = headingLine.exec(line);
        if (match) {
          const source = headingLine.exec(block.text.slice(at, at + line.length));
          out.push({ depth: match[1].length, text: source?.[2] ?? match[2], offset: offset + at });
        }
        at += line.length + 1;
      }
    }
    offset += block.text.length;
  }
  return out;
}

/**
 * The text a heading renders as, which is what Astro slugs: code spans keep
 * their content, a link keeps its text, and emphasis and HTML go.
 */
export function plainText(heading: string): string {
  return heading
    .replace(/(`+)(.+?)\1/g, "$2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2");
}

/** Slugs for a page's headings in order, the way Astro numbers a repeated one. */
export function slugs(texts: string[]): string[] {
  const slugger = new GithubSlugger();
  return texts.map((text) => slugger.slug(plainText(text)));
}

export interface Rewriter {
  /** The destination a link should have instead; called for every link outside code. */
  link(destination: string): string;
  /** Where `ADR-nnnn` in prose should link, or nothing to leave it as text. */
  adr?(number: string): string | undefined;
  /** How many levels to raise each heading by: a page split out at `##` raises its `###` to `##`. */
  raise?: number;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const linkDestination = /\]\([ \t]*(<[^>\n]*>|[^\s()]+)([ \t]+"[^"\n]*")?[ \t]*\)/g;
const referenceDefinition = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm;
const linkText = /\[[^\]\n]*\]\(/g;
const adrMention = /\bADR-(\d{4})\b/g;

/** Rewrites a document's links, headings and ADR numbers, leaving code alone. */
export function rewrite(markdown: string, rewriter: Rewriter): string {
  return blocks(markdown)
    .map((block) => (block.code ? block.text : rewriteProse(block.text, rewriter)))
    .join("");
}

function rewriteProse(text: string, rewriter: Rewriter): string {
  const masked = maskCode(text);
  const edits: Edit[] = [];

  for (const pattern of [linkDestination, referenceDefinition]) {
    for (const match of masked.matchAll(pattern)) {
      const raw = match[1];
      const start = (match.index ?? 0) + match[0].indexOf(raw);
      const bracketed = raw.startsWith("<");
      const destination = bracketed ? raw.slice(1, -1) : raw;
      const next = rewriter.link(destination);
      if (next !== destination) {
        edits.push({ start, end: start + raw.length, text: bracketed ? `<${next}>` : next });
      }
    }
  }

  const headingLines: [number, number][] = [];
  let at = 0;
  for (const line of masked.split("\n")) {
    const match = headingLine.exec(line);
    if (match) {
      headingLines.push([at, at + line.length]);
      const raise = rewriter.raise ?? 0;
      if (raise > 0) {
        const depth = Math.max(1, match[1].length - raise);
        const hashes = line.indexOf("#");
        edits.push({
          start: at + hashes,
          end: at + hashes + match[1].length,
          text: "#".repeat(depth),
        });
      }
    }
    at += line.length + 1;
  }

  if (rewriter.adr) {
    const inLinkText = [...masked.matchAll(linkText)].map((match): [number, number] => [
      match.index ?? 0,
      (match.index ?? 0) + match[0].length,
    ]);
    const inside = (ranges: [number, number][], offset: number) =>
      ranges.some(([start, end]) => offset >= start && offset < end);
    for (const match of masked.matchAll(adrMention)) {
      const offset = match.index ?? 0;
      if (inside(inLinkText, offset) || inside(headingLines, offset)) continue;
      const href = rewriter.adr(match[1]);
      if (href)
        edits.push({
          start: offset,
          end: offset + match[0].length,
          text: `[${match[0]}](${href})`,
        });
    }
  }

  let out = text;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** A section of a document under one heading of the given depth, the heading line itself removed. */
export interface Section {
  /** The heading's text, or null for what comes before the first one. */
  title: string | null;
  body: string;
}

/** Cuts a document at every heading of `depth`, outside code. */
export function sections(markdown: string, depth: number): Section[] {
  const cuts = headings(markdown).filter((heading) => heading.depth === depth);
  const out: Section[] = [
    { title: null, body: markdown.slice(0, cuts[0]?.offset ?? markdown.length) },
  ];
  cuts.forEach((cut, i) => {
    const end = cuts[i + 1]?.offset ?? markdown.length;
    const lineEnd = markdown.indexOf("\n", cut.offset);
    out.push({
      title: cut.text,
      body: lineEnd < 0 || lineEnd > end ? "" : markdown.slice(lineEnd + 1, end),
    });
  });
  return out;
}

/** The first paragraph of prose, as plain text, for a page's description; nothing if it opens otherwise. */
export function firstParagraph(markdown: string): string | undefined {
  for (const block of blocks(markdown)) {
    if (block.code) return undefined;
    const paragraph = block.text
      .split(/\n[ \t]*\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0);
    if (paragraph === undefined) continue;
    if (/^([#>|*+-]|\d+\.|<|!\[)/.test(paragraph)) return undefined;
    return plainText(paragraph.replace(/\s*\n\s*/g, " "));
  }
  return undefined;
}

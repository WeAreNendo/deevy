import { applyPatch, structuredPatch } from "diff";

/**
 * A three-way merge of markdown (ADR-0021). An Agent reads a Document, takes a
 * while to think, and writes a whole body back — by which time a Human may have
 * been typing in it. What lands is what the Agent **changed** (`base` → `mine`)
 * replayed onto what the Document says **now** (`theirs`), so a paragraph
 * somebody else was in is not pasted over by a body composed before they
 * started.
 *
 * Where the two genuinely collide — the same lines, changed on both sides — the
 * merge refuses and names the sections it could not place. The Agent re-reads
 * and tries again, which is the thing an Agent is good at and a Human is not.
 */
export type Merged = { ok: true; text: string } | { ok: false; clashed: string[] };

export interface ThreeWay {
  /** What the Agent read. Null when it read nothing we can identify, and then its body is the write. */
  base: string | null;
  /** What the Agent wrote. */
  mine: string;
  /** What the Document says now. */
  theirs: string;
}

export function mergeMarkdown({ base, mine, theirs }: ThreeWay): Merged {
  if (base === null) return { ok: true, text: mine };
  if (base === mine) return { ok: true, text: theirs };
  if (base === theirs) return { ok: true, text: mine };

  // One line of context rather than three: a Document is prose, and two people
  // working in neighbouring paragraphs would otherwise be a clash because one
  // edit sat inside the other's context.
  const patch = structuredPatch(
    "document",
    "document",
    withNewline(base),
    withNewline(mine),
    "",
    "",
    {
      context: 1,
    },
  );
  // `applyPatch` returns false when a hunk's context is no longer there, which
  // is exactly the case worth refusing: the Agent's change was written against
  // lines that have since been rewritten.
  const applied = applyPatch(withNewline(theirs), patch);
  if (applied !== false) return { ok: true, text: applied.trimEnd() };

  return { ok: false, clashed: clashedSections(patch.hunks, theirs) };
}

/** A patch applies or it does not; this is which parts of it did not, by heading. */
function clashedSections(hunks: ReturnType<typeof structuredPatch>["hunks"], theirs: string) {
  const named = new Set<string>();
  for (const hunk of hunks) {
    const alone = { ...emptyPatch(), hunks: [hunk] };
    if (applyPatch(withNewline(theirs), alone) === false) {
      named.add(headingAbove(theirs, hunk.oldStart));
    }
  }
  // A patch that fails as a whole but whose hunks each apply alone is still a
  // refusal; without a name for it, say the Document.
  return named.size > 0 ? [...named] : ["the Document"];
}

function emptyPatch() {
  return {
    oldFileName: "document",
    newFileName: "document",
    oldHeader: "",
    newHeader: "",
    hunks: [],
  };
}

/** The markdown heading a line sits under, which is how a Human and an Agent both refer to it. */
function headingAbove(text: string, line: number): string {
  const lines = text.split("\n");
  for (let at = Math.min(line, lines.length) - 1; at >= 0; at--) {
    const candidate = lines[at];
    if (candidate && /^#{1,6}\s+\S/.test(candidate)) return candidate.trim();
  }
  return "the top of the Document";
}

/** Patches are line-based, and a file without a trailing newline loses its last line. */
function withNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

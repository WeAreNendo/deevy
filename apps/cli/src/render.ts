/**
 * An answer, shaped for a person.
 *
 * Driven by what the value looks like rather than by which operation produced
 * it. A table of renderers per operation would be the hand-maintained list this
 * CLI exists not to have — ninety-three entries to keep in step with a registry
 * that already describes itself — so this reads the value: a list becomes a
 * table, a single thing becomes its fields, and anything unrecognised is still
 * printed rather than hidden.
 *
 * `--json` is exact and is what a script reads. This is for the other reader,
 * and the bar it has to clear is that nothing it shows is misleading: a column
 * that is missing is terse, and a column showing `st_w861nwy0a5h5` where the
 * State is called "Intent" is worse than no column at all.
 */

/** Colour only when somebody is looking: a pipe gets plain text. */
export interface Ink {
  dim: (text: string) => string;
  bold: (text: string) => string;
}

export const plain: Ink = { dim: (text) => text, bold: (text) => text };
export const coloured: Ink = {
  dim: (text) => `[2m${text}[22m`,
  bold: (text) => `[1m${text}[22m`,
};

export function inkFor(stream: { isTTY?: boolean } = process.stdout): Ink {
  // NO_COLOR is the convention every other tool honours, and an empty value
  // counts as unset there.
  if (process.env.NO_COLOR) return plain;
  return stream.isTTY === true ? coloured : plain;
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * A value that fits in a cell.
 *
 * A Date is one, which is not obvious and cost a review round: the RPC link
 * deserialises deevy's `timestamp_ms` columns back into real Dates, so every
 * "when" in the whole API — `readAt`, `suspendedAt`, `disabledAt`,
 * `startedAt` — is an object, and a rule that skipped objects dropped all of
 * them. An inbox that cannot show what is unread is not an inbox.
 */
const isScalar = (value: unknown): boolean =>
  value === null || value === undefined || typeof value !== "object" || value instanceof Date;

/**
 * The fields worth showing first, in the order a person reads them.
 *
 * Not a schema and not per operation: these are the names deevy's vocabulary
 * uses for the same things everywhere (CONTEXT.md), so a shape carrying `key`
 * and `title` is an Issue's shape whatever returned it. `status` is here as
 * Run's own field name rather than as a synonym for State, which CONTEXT.md
 * asks nobody to use.
 */
const LEADING = ["key", "handle", "name", "title", "slug", "status", "state", "role", "kind"];
/** Present in almost everything and interesting in almost nothing. */
const TRAILING = [
  "id",
  "workspaceId",
  "projectId",
  "userId",
  "sponsorId",
  "createdAt",
  "updatedAt",
];
/** Free prose. The worst possible column, however useful the field is. */
const NEVER_A_COLUMN = ["description", "body", "summary", "documentTemplate", "payload"];

/**
 * What a nested object is worth as a column.
 *
 * One level, and only into the names above: an Issue's `state` is an object
 * whose `name` is "Intent", and showing the `stateId` beside it was showing an
 * opaque id in place of an answer the payload already had.
 */
function reachInto(value: unknown): string | null {
  if (!isRow(value)) return null;
  for (const name of ["name", "key", "handle", "title"]) {
    const inner = value[name];
    if (typeof inner === "string") return inner;
  }
  return null;
}

function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);

  const usable = [...seen].filter(
    (key) =>
      !NEVER_A_COLUMN.includes(key) &&
      rows.every((row) => isScalar(row[key]) || reachInto(row[key]) !== null) &&
      // A column blank in every row is five columns' worth of nothing: three
      // of the five `projects list` showed were empty for every Project.
      rows.some((row) => cell(row[key]) !== ""),
  );

  // An id whose named counterpart is also here is noise taking a column: with
  // `state` showing "Intent", `stateId` shows `st_w861nwy0a5h5` beside it, and
  // `assigneeMemberId` was costing the slot `assignee` needed.
  const named = new Set(usable.filter((key) => rows.some((row) => reachInto(row[key]) !== null)));
  const redundant = (key: string): boolean => {
    const base = key.replace(/(MemberId|Id)$/, "");
    return base !== key && named.has(base);
  };

  const leading = LEADING.filter((key) => usable.includes(key));
  const middle = usable.filter(
    (key) => !leading.includes(key) && !TRAILING.includes(key) && !redundant(key),
  );
  const chosen = [...leading, ...middle].slice(0, 5);
  // A row with a time in it and no room for one says less than CONTEXT.md says
  // an Event is: what changed, who did it, and when.
  if (!chosen.some((key) => rows.some((row) => row[key] instanceof Date))) {
    const when = usable.find((key) => rows.some((row) => row[key] instanceof Date));
    if (when) return [...chosen.slice(0, 4), when];
  }
  return chosen;
}

/** Long enough to recognise the thing, short enough to keep a grid a grid. */
const CELL_LIMIT = 48;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 16);
  if (typeof value === "string") return clip(value);
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  const reached = reachInto(value);
  if (reached !== null) return clip(reached);
  if (Array.isArray(value)) return `${String(value.length)} items`;
  return "…";
}

/**
 * One line, bounded. A newline in a cell breaks the grid outright, and an
 * unbounded one makes every other row that wide — a single 3 KB description
 * made a two-row table nine thousand characters of mostly padding.
 */
function clip(text: string): string {
  const oneLine = text.replace(/\s*\n\s*/g, " ").trim();
  return oneLine.length > CELL_LIMIT ? `${oneLine.slice(0, CELL_LIMIT - 1)}…` : oneLine;
}

/**
 * How wide a string looks, which is not how long it is.
 *
 * Issue titles are free text. A CJK character occupies two columns and one
 * UTF-16 unit; an emoji outside the BMP occupies two columns and two units; a
 * decomposed accent occupies none and one. `padEnd` counts units, so all three
 * left the grid crooked.
 */
export function width(text: string): number {
  let total = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    // Combining marks: part of the character before them.
    if (point >= 0x300 && point <= 0x36f) continue;
    total += isWide(point) ? 2 : 1;
  }
  return total;
}

const isWide = (point: number): boolean =>
  (point >= 0x1100 && point <= 0x115f) ||
  (point >= 0x2e80 && point <= 0xa4cf) ||
  (point >= 0xac00 && point <= 0xd7a3) ||
  (point >= 0xf900 && point <= 0xfaff) ||
  (point >= 0xfe30 && point <= 0xfe6f) ||
  (point >= 0xff00 && point <= 0xff60) ||
  (point >= 0xffe0 && point <= 0xffe6) ||
  (point >= 0x1f300 && point <= 0x1faff);

const pad = (text: string, to: number): string => text + " ".repeat(Math.max(0, to - width(text)));

function table(rows: Row[], ink: Ink): string {
  const columns = columnsOf(rows);
  if (columns.length === 0) return rows.map((row) => JSON.stringify(row)).join("\n");
  const widths = columns.map((column) =>
    Math.max(width(column), ...rows.map((row) => width(cell(row[column])))),
  );
  const line = (values: string[]) =>
    values
      .map((value, index) => pad(value, widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [
    ink.bold(line(columns)),
    ...rows.map((row) => line(columns.map((column) => cell(row[column])))),
  ].join("\n");
}

/**
 * A single thing, as its fields.
 *
 * Nested shapes are indented under their key rather than stringified onto one
 * line: an Issue carries eight objects and arrays, and putting each on a line
 * of its own made `issues get` strictly worse to read than the JSON it
 * replaced.
 */
function fields(row: Row, ink: Ink, depth = 0): string {
  const indent = "  ".repeat(depth);
  const keys = Object.keys(row);
  const scalarWidth = Math.max(
    0,
    ...keys.filter((key) => isScalar(row[key])).map((key) => width(key)),
  );
  const lines: string[] = [];
  for (const key of keys) {
    const value = row[key];
    if (isScalar(value)) {
      const shown = value instanceof Date ? cell(value) : longForm(value);
      lines.push(`${indent}${ink.dim(pad(key, scalarWidth))}  ${shown}`);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`${indent}${ink.dim(key)} (${String(value.length)})`);
      if (value.length > 0 && value.every(isRow)) {
        lines.push(
          table(value as Row[], ink)
            .split("\n")
            .map((one) => `${indent}  ${one}`)
            .join("\n"),
        );
      }
      continue;
    }
    lines.push(`${indent}${ink.dim(key)}`);
    lines.push(fields(value as Row, ink, depth + 1));
  }
  return lines.join("\n");
}

/** Not a cell, so not clipped: this is the one place the whole value belongs. */
function longForm(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  // Narrowed rather than cast: only `fields` calls this, and only for values
  // `isScalar` accepted, but the compiler cannot see that and an object
  // reaching String() would print "[object Object]".
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

/**
 * What to print, given what came back.
 *
 * The shapes, in the order they are recognised: an answer that is only that
 * something happened, a wrapper around one list, a bare list, and a single
 * thing.
 */
export function render(answer: unknown, ink: Ink = plain): string {
  if (answer === null || answer === undefined) return "";
  if (typeof answer === "string") return answer;
  if (typeof answer === "number" || typeof answer === "boolean" || typeof answer === "bigint") {
    return String(answer);
  }
  if (typeof answer !== "object") return JSON.stringify(answer) ?? "";
  if (answer instanceof Date) return cell(answer);

  if (Array.isArray(answer)) {
    if (answer.length === 0) return ink.dim("None.");
    return answer.every(isRow) ? table(answer, ink) : answer.map((one) => cell(one)).join("\n");
  }

  const row = answer as Row;
  const keys = Object.keys(row);

  // `{ deleted: true }`, `{ read: 3 }`: an operation whose whole answer is that
  // it happened, or how many times it did.
  if (keys.length === 1) {
    const [only = ""] = keys;
    const value = row[only];
    if (typeof value === "boolean") return value ? `${only}.` : `not ${only}.`;
    if (typeof value === "number") return `${String(value)} ${only}.`;
  }

  // `{ issues: [...], nextCursor }` — the shape every list answers with.
  //
  // A wrapper is only a wrapper: one array and a little else. Requiring that
  // keeps `health.ping` — five facts about an instance, one of them a list of
  // sign-in providers — from answering a liveness check with a table of
  // providers, or with the word "None."
  const listKey = keys.find((key) => Array.isArray(row[key]));
  const wrapper =
    listKey !== undefined &&
    keys.length <= 3 &&
    !("id" in row) &&
    !("key" in row) &&
    keys.every((key) => key === listKey || isScalar(row[key]));
  if (wrapper && listKey !== undefined && (row[listKey] as unknown[]).every(isRow)) {
    const rows = row[listKey] as Row[];
    const beside = keys
      .filter((key) => key !== listKey && row[key] !== null && row[key] !== undefined)
      .map((key) => `${key}: ${cell(row[key])}`);
    const body = rows.length === 0 ? ink.dim("None.") : table(rows, ink);
    return beside.length > 0 ? `${body}\n${ink.dim(beside.join("  "))}` : body;
  }

  return fields(row, ink);
}

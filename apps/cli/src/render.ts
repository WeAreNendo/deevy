/**
 * An answer, shaped for a person.
 *
 * Driven by what the value looks like rather than by which operation produced
 * it. A table of renderers per operation would be the hand-maintained list this
 * CLI exists not to have — ninety-three entries to keep in step with a registry
 * that already describes itself — so this reads the value: a list becomes a
 * table, a row with a key and a title is an Issue whoever returned it, and
 * anything unrecognised is still printed rather than hidden.
 *
 * `--json` is exact and is what a script reads. This is for the other reader.
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
  // NO_COLOR is the convention every other tool honours.
  if (process.env.NO_COLOR !== undefined) return plain;
  return stream.isTTY === true ? coloured : plain;
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The fields worth showing first, in the order a person reads them.
 *
 * Not a schema and not per operation: these are the names deevy's vocabulary
 * uses for the same things everywhere (CONTEXT.md), so a shape carrying `key`
 * and `title` is an Issue's shape whatever returned it.
 */
const LEADING = [
  "key",
  "handle",
  "name",
  "title",
  "slug",
  "summary",
  "status",
  "state",
  "role",
  "kind",
];
/** Present in almost everything and interesting in almost nothing. */
const TRAILING = ["id", "createdAt", "updatedAt", "workspaceId", "projectId"];

function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  const scalar = [...seen].filter((key) =>
    rows.every((row) => row[key] === null || row[key] === undefined || !isObjectish(row[key])),
  );
  const leading = LEADING.filter((key) => scalar.includes(key));
  const rest = scalar.filter((key) => !leading.includes(key) && !TRAILING.includes(key));
  // Enough to recognise a row by, and not the whole schema: --json is there
  // for the whole schema.
  return [...leading, ...rest].slice(0, 5);
}

const isObjectish = (value: unknown): boolean => typeof value === "object" && value !== null;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `${String(value.length)} items`;
  return "…";
}

function table(rows: Row[], ink: Ink): string {
  const columns = columnsOf(rows);
  if (columns.length === 0) return rows.map((row) => JSON.stringify(row)).join("\n");
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => cell(row[column]).length)),
  );
  const line = (values: string[], paint: (text: string) => string) =>
    paint(
      values
        .map((value, index) => value.padEnd(widths[index] ?? 0))
        .join("  ")
        .trimEnd(),
    );
  return [
    line(columns, ink.dim),
    ...rows.map((row) =>
      line(
        columns.map((column) => cell(row[column])),
        (text) => text,
      ),
    ),
  ].join("\n");
}

function fields(row: Row, ink: Ink): string {
  const keys = Object.keys(row);
  const width = Math.max(0, ...keys.map((key) => key.length));
  return keys
    .map((key) => {
      const value = row[key];
      const shown = isObjectish(value) ? JSON.stringify(value) : cell(value);
      return `${ink.dim(key.padEnd(width))}  ${shown}`;
    })
    .join("\n");
}

/**
 * What to print, given what came back.
 *
 * The shapes, in the order they are recognised: a wrapper around one list (what
 * every `list` operation answers with), a bare list, a single row, and anything
 * else as JSON because pretending otherwise would lose it.
 */
export function render(answer: unknown, ink: Ink = plain): string {
  if (answer === null || answer === undefined) return "";
  // A scalar answer: narrowed rather than cast, so the linter can see that
  // nothing here is an object being stringified into "[object Object]".
  if (typeof answer === "string") return answer;
  if (typeof answer === "number" || typeof answer === "boolean" || typeof answer === "bigint") {
    return String(answer);
  }
  if (typeof answer !== "object") return JSON.stringify(answer) ?? "";

  if (Array.isArray(answer)) {
    if (answer.length === 0) return ink.dim("None.");
    return answer.every(isRow) ? table(answer, ink) : answer.map((one) => cell(one)).join("\n");
  }

  const row = answer as Row;
  const keys = Object.keys(row);

  // `{ deleted: true }`, `{ revoked: true }`: an operation whose whole answer
  // is that it happened.
  if (keys.length === 1 && typeof row[keys[0] ?? ""] === "boolean") {
    const [only] = keys;
    return row[only ?? ""] === true ? `${only ?? ""}.` : `not ${only ?? ""}.`;
  }

  // `{ issues: [...], nextCursor }` — the shape every list answers with. The
  // list is the answer; what rides beside it goes underneath.
  //
  // A wrapper, not a row that happens to carry a list: one Issue with its
  // Labels on it is an Issue, and was briefly rendered as a table of its
  // Labels. An entity names itself with an id or a key, so a shape that does
  // is read as one.
  const wrapper = !("id" in row) && !("key" in row);
  const listKey = wrapper ? keys.find((key) => Array.isArray(row[key])) : undefined;
  if (listKey && (row[listKey] as unknown[]).every(isRow)) {
    const rows = row[listKey] as Row[];
    const beside = keys
      .filter((key) => key !== listKey && row[key] !== null && row[key] !== undefined)
      .map((key) => `${key}: ${cell(row[key])}`);
    const body = rows.length === 0 ? ink.dim("None.") : table(rows, ink);
    return beside.length > 0 ? `${body}\n${ink.dim(beside.join("  "))}` : body;
  }

  return fields(row, ink);
}

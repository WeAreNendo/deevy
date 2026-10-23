import { DrizzleQueryError, is } from "drizzle-orm";

/** How far down a chain of causes a description looks. */
const MAX_DEPTH = 5;

/**
 * An error as a log line that says nothing from the database, for a log whose
 * reader is not the Workspace's own: deevy Cloud's, which promise to carry
 * nothing from a Workspace's database (apps/docs/content/cloud/support.md).
 *
 * A failed query throws drizzle's `DrizzleQueryError`, whose message is the
 * SQL followed by every value it was bound to — the row being written, a
 * Human's address — and whose stack begins with that message. So what is said
 * is chosen rather than filtered: each error's name and code down the chain of
 * causes; for a failed query its SQL, whose values are placeholders, and the
 * database's own reason, which names a column or a constraint and never a
 * value; and the frames of the deepest error, which are code. Every other
 * message is left out, because what deevy or a library writes into one — a
 * Socket's name, an Issue's URL, a parser's snippet of its input — may have
 * come from the database too. The engine's are no exception: V8 writes the
 * value it was handed into a TypeError (`Cannot read properties of undefined
 * (reading '<a key from a row>')`, `Cannot use 'in' operator to search for 'x'
 * in <a string>`), a RangeError and a SyntaxError alike.
 *
 * The image and the self-hosted Worker log errors whole: that log is the
 * operator's own, and the message is what they debug with.
 */
export function describeError(error: unknown): string {
  const said: string[] = [];
  let frames: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current !== null; depth++) {
    if (!(current instanceof Error)) {
      said.push(`a thrown ${typeof current}`);
      break;
    }
    const own = framesOf(current);
    if (own.length > 0) frames = own;
    if (is(current, DrizzleQueryError)) {
      said.push(`${nameOf(current)}: ${current.query}`);
      const reason = current.cause;
      if (reason instanceof Error) {
        said.push(`${nameOf(reason)}: ${reason.message}`);
        const deepest = framesOf(reason);
        if (deepest.length > 0) frames = deepest;
      }
      break;
    }
    said.push(nameOf(current));
    current = current.cause;
  }
  return [said.join(", caused by ") || "an error with nothing to say", ...frames].join("\n");
}

/**
 * A failed query's message without the values drizzle appended to it, for a
 * library that logs one as its line (Better Auth logs the message of a
 * database error that mentions a column or a table on its own).
 */
export function withoutBoundValues(message: string): string {
  return message.replace(/\nparams: [\s\S]*$/, "");
}

/** The name, and the code when it is one: `ERR_SQLITE_ERROR`, `INTERNAL_SERVER_ERROR`. */
function nameOf(error: Error): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)
    ? `${error.name} ${code}`
    : error.name;
}

/** The `at …` lines of a stack, and none of the message before them. */
function framesOf(error: Error): string[] {
  return (error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
}

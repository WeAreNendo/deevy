/**
 * What a zod field looks like from a command line.
 *
 * The schema decides everything a flag needs to know — whether it takes a
 * value, whether it may be repeated, what it is called, what it accepts — so
 * this reads the schema rather than a table somebody maintains beside it. zod
 * still does the validating: this only works out how to collect argv into the
 * shape zod is expecting, because a command line hands you strings and a schema
 * wants numbers, booleans and arrays.
 */

/** The zod internals this reads. One place, so a zod bump breaks one function. */
interface ZodDef {
  type?: string;
  innerType?: unknown;
  element?: unknown;
  entries?: Record<string, string>;
  options?: unknown[];
  values?: unknown[];
  in?: unknown;
}

function defOf(schema: unknown): ZodDef | undefined {
  return (schema as { def?: ZodDef } | undefined)?.def;
}

/** What `.describe()` put there, which becomes the flag's help text. */
function describedAs(schema: unknown): string | undefined {
  const meta = (schema as { description?: string } | undefined)?.description;
  return typeof meta === "string" && meta.length > 0 ? meta : undefined;
}

export type FieldKind = "string" | "number" | "boolean" | "enum" | "array" | "json";

export interface Field {
  name: string;
  kind: FieldKind;
  /** Whether a value must be given: an optional or defaulted field need not be. */
  required: boolean;
  /** For an array, the kind of one element — a repeated flag collects them. */
  element?: FieldKind;
  /** For an enum, what it accepts, which commander shows in `--help`. */
  choices?: string[];
  description?: string;
}

/**
 * Unwrap the wrappers that say "you need not give this" until something that
 * says what it is. `z.string().optional().default("x")` is three layers deep
 * and is still a string.
 */
function unwrap(schema: unknown): { inner: unknown; required: boolean } {
  let inner = schema;
  let required = true;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = defOf(inner);
    if (!def) break;
    if (def.type === "optional" || def.type === "default" || def.type === "prefault") {
      required = false;
      inner = def.innerType;
      continue;
    }
    if (def.type === "nullable" || def.type === "readonly" || def.type === "nonoptional") {
      inner = def.innerType;
      continue;
    }
    break;
  }
  return { inner, required };
}

function kindOf(schema: unknown): { kind: FieldKind; choices?: string[]; element?: FieldKind } {
  const def = defOf(schema);
  switch (def?.type) {
    case "string":
      return { kind: "string" };
    case "number":
    case "int":
    case "bigint":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "enum": {
      // zod 4 keeps an enum's members in `entries`; a literal union has options.
      const entries = def.entries ? Object.values(def.entries) : [];
      return { kind: "enum", choices: entries.map(String) };
    }
    case "literal": {
      const values = def.values ?? [];
      return { kind: "enum", choices: values.map(String) };
    }
    case "array":
      return { kind: "array", element: kindOf(unwrap(def.element).inner).kind };
    case "pipe":
      // `z.stringbool()` and friends: what it accepts is the input side.
      return kindOf(unwrap(def.in).inner);
    case "union": {
      // deevy's `QueryFlag` is `z.union([z.boolean(), z.stringbool()])`, so a
      // union that will take a boolean is a switch on a command line. A union
      // of one kind is that kind; anything genuinely mixed stays JSON.
      const kinds = (def.options ?? []).map((option) => kindOf(unwrap(option).inner));
      if (kinds.some((one) => one.kind === "boolean")) return { kind: "boolean" };
      const distinct = new Set(kinds.map((one) => one.kind));
      if (distinct.size === 1 && kinds[0]) return kinds[0];
      return { kind: "json" };
    }
    default:
      // A union, an object, a record: still reachable, but only as JSON. The
      // alternative is inventing a syntax for it, which is a worse trade than
      // asking for the thing the schema already describes.
      return { kind: "json" };
  }
}

/** Every field of an operation's input, as flags. */
export function fieldsOf(inputSchema: unknown): Field[] {
  const shape = (inputSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  if (!shape) return [];
  return Object.entries(shape).map(([name, schema]) => {
    const { inner, required } = unwrap(schema);
    const { kind, choices, element } = kindOf(inner);
    return {
      name,
      kind,
      required,
      ...(element ? { element } : {}),
      ...(choices && choices.length > 0 ? { choices } : {}),
      ...((describedAs(schema) ?? describedAs(inner))
        ? { description: describedAs(schema) ?? describedAs(inner) }
        : {}),
    };
  });
}

/** `assigneeMemberId` becomes `--assignee-member-id`. */
export function flagNameFor(field: string): string {
  return `--${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

/**
 * Argv arrives as strings; the schema wants what it wants.
 *
 * Only what the kind says, and nothing clever: a string stays a string, so an
 * Issue title of "42" is not quietly a number. Anything that does not convert
 * is handed to zod as it came, because zod's message about it is better than
 * one invented here.
 */
export function coerce(raw: string | string[] | boolean, field: Field): unknown {
  if (field.kind === "array") {
    const many = Array.isArray(raw) ? raw : [String(raw)];
    return many.map((one) => coerce(one, { ...field, kind: field.element ?? "string" }));
  }
  if (typeof raw === "boolean") return raw;
  const value = Array.isArray(raw) ? (raw[raw.length - 1] ?? "") : raw;
  switch (field.kind) {
    case "number": {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case "boolean":
      return value === "false" ? false : value === "true" ? true : value;
    case "json":
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

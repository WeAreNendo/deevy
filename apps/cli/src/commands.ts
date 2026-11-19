/**
 * Every operation an Agent may call, as a command.
 *
 * This is the fourth projection of the one typed core (ADR-0005): the same
 * `defineOperation` that becomes a REST route, an MCP tool and a typed browser
 * client becomes a command here. Nothing about a command is written down twice
 * — the name, the summary, which arguments are positional and which are flags
 * are all read off the definition — so an operation added tomorrow is a command
 * tomorrow, and one that changes its input changes its flags.
 *
 * The CLI acts as the Agent whose key it holds and as nobody else (ADR-0035),
 * so an operation only a Human may call is no command of its: one that could
 * only ever be refused would teach nothing a reference page does not.
 *
 * It walks the router rather than a generated file on purpose. The zod schema
 * is the thing worth having: it validates argv with the refinements and
 * coercions the operation actually declared, which a JSON Schema snapshot of it
 * would flatten away.
 */
import { Procedure } from "@orpc/server";
import type { OperationMeta } from "@deevy/core";
import { getOperationMeta } from "@deevy/core";

/** One operation, as the CLI sees it. */
export interface CommandDescriptor {
  /**
   * The words a user types: `["inbox", "mark-read"]`. Not the operation's
   * HTTP path, which is where `parameters` comes from — the two are different
   * things and sat under one name here until a review said so.
   */
  words: string[];
  /** The dotted registry name, and the join back to every other surface. */
  operation: string;
  summary: string;
  /** GET operations only read, which is what lets one skip a confirmation. */
  readOnly: boolean;
  /**
   * Named in the operation's `path` as `{key}`, in the order they appear, and
   * taken as positional arguments. Everything else in the input object is a
   * flag: the registry does not mark path parameters, so this is the only
   * thing that distinguishes them (`/issues/{key}/labels` → `["key"]`).
   */
  parameters: string[];
  inputSchema: unknown;
  outputSchema: unknown;
}

/**
 * oRPC keeps a procedure's schemas on a private field, so every read of it is
 * here — the same isolation `packages/core/src/mcp/tools.ts` keeps, for the
 * same reason: a beta bump that renames it breaks this function and nothing
 * else.
 */
function schemasOf(procedure: object): { inputSchema: unknown; outputSchema: unknown } {
  const internals = (procedure as { "~orpc"?: Record<string, unknown> })["~orpc"];
  if (!internals) throw new Error("commandsFor: this oRPC procedure exposes no internals");
  // They are arrays because oRPC lets a procedure narrow its input more than
  // once; the last entry is the effective schema. Anything else means the
  // internals moved under us, which is a build failure, not a silent command.
  const input = internals.inputSchemas;
  const output = internals.outputSchemas;
  if (!Array.isArray(input) || !Array.isArray(output) || input.length === 0) {
    throw new Error("commandsFor: oRPC no longer exposes inputSchemas/outputSchemas as arrays");
  }
  return { inputSchema: unwrapped(input.at(-1)), outputSchema: output.at(-1) };
}

/**
 * `NoInput` is `z.object({}).optional()`, so sixteen operations arrive wrapped
 * and the rest do not. Unwrapping is done once, here, because the thing that
 * knows about `NoInput` should be the walk and not every consumer of it: a flag
 * generator handed a sometimes-optional schema either crashes or silently
 * produces a command with no flags.
 */
function unwrapped(schema: unknown): unknown {
  const inner = (schema as { def?: { innerType?: unknown }; _def?: { innerType?: unknown } })?.def
    ?.innerType;
  return inner ?? schema;
}

/**
 * `inbox.markRead` becomes `inbox mark-read`.
 *
 * Dotted names are the registry's, and a command line is words: the dot is the
 * group and camelCase is a hyphen, which is what every other CLI looks like.
 * `commandsFor` proves the mapping stays injective, the way `projectTools`
 * does for tool names.
 */
export function commandWords(operation: string): string[] {
  return operation
    .split(".")
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
}

/** The `{name}` segments of an operation's path, in the order they appear. */
export function parametersOf(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] as string);
}

function collect(node: unknown, found: CommandDescriptor[]): void {
  if (node instanceof Procedure) {
    const meta = getOperationMeta(node) as OperationMeta | undefined;
    // Every operation an Agent may call, a wider list than the MCP projection's:
    // a command line has no context window to protect. `public` answers anybody
    // before it asks who (registry.ts), so it is an Agent's to call too.
    if (!meta || (meta.agents !== true && meta.auth !== "public")) return;
    // A stream's handler returns an async generator, and every command awaits
    // a value, which for a stream waits forever. None is an Agent's today: the
    // one there is, `events.subscribe`, is a Human's.
    if (meta.stream === true) return;
    found.push({
      words: commandWords(meta.name),
      operation: meta.name,
      summary: meta.summary,
      readOnly: meta.method === "GET",
      parameters: parametersOf(meta.path),
      ...schemasOf(node),
    });
    return;
  }
  if (node && typeof node === "object") {
    for (const child of Object.values(node)) collect(child, found);
  }
}

/**
 * Every operation an Agent may call, in stable name order so a diff of the
 * command list moves only when the surface does.
 */
export function commandsFor(router: unknown): CommandDescriptor[] {
  const found: CommandDescriptor[] = [];
  collect(router, found);
  found.sort((a, b) => a.operation.localeCompare(b.operation));

  const names = new Set(found.map((command) => command.words.join(" ")));
  if (names.size !== found.length) {
    // Two dotted names collapsing to one command would silently shadow an
    // operation, so it fails here rather than at somebody's prompt.
    throw new Error("commandsFor: two operations share one command name");
  }
  // And one name being a prefix of another — `agents keys` beside `agents keys
  // issue` — is the same failure wearing a different shape: a command that both
  // acts and owns subcommands is not something a command line can express. The
  // router has no such pair today; `agents.keys.*` is already a group, so the
  // one that would create it is an obvious next step.
  for (const command of found) {
    const prefix = `${command.words.join(" ")} `;
    const shadowed = [...names].find((name) => name.startsWith(prefix));
    if (shadowed) {
      throw new Error(`commandsFor: "${command.words.join(" ")}" is a prefix of "${shadowed}"`);
    }
  }
  return found;
}

/**
 * Every operation in deevy's registry, as a command.
 *
 * This is the fourth projection of the one typed core (ADR-0005): the same
 * `defineOperation` that becomes a REST route, an MCP tool and a typed browser
 * client becomes a command here. Nothing about a command is written down twice
 * — the name, the summary, which arguments are positional and which are flags
 * are all read off the definition — so an operation added tomorrow is a command
 * tomorrow, and one that changes its input changes its flags.
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
  /** The command path a user types: `["issues", "set-labels"]`. */
  path: string[];
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
  /** Whether an Agent's API key may call it; a Human's token may not, if agentsOnly. */
  agents: boolean;
  agentsOnly: boolean;
  /**
   * Refused to every credential a CLI can hold: it wants a Human in deevy's own
   * browser (ADR-0010). Kept in the list rather than dropped, so the CLI can
   * say why instead of letting the server answer a bare FORBIDDEN.
   */
  sessionOnly: boolean;
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
  const input = internals.inputSchemas;
  const output = internals.outputSchemas;
  if (!Array.isArray(input) || !Array.isArray(output) || input.length === 0) {
    throw new Error("commandsFor: oRPC no longer exposes inputSchemas/outputSchemas as arrays");
  }
  return { inputSchema: input.at(-1), outputSchema: output.at(-1) };
}

/**
 * `issues.setLabels` becomes `issues set-labels`.
 *
 * Dotted names are the registry's, and a command line is words: the dot is the
 * group and camelCase is a hyphen, which is what every other CLI looks like.
 * `commandsFor` proves the mapping stays injective, the way `projectTools`
 * does for tool names.
 */
export function commandPath(operation: string): string[] {
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
    // Every operation, unlike the MCP projection: a command line has no context
    // window to protect, so the only reason to leave one out would be that it
    // cannot work, and that is a decision the caller makes from these flags.
    if (!meta) return;
    found.push({
      path: commandPath(meta.name),
      operation: meta.name,
      summary: meta.summary,
      readOnly: meta.method === "GET",
      parameters: parametersOf(meta.path),
      agents: meta.agents === true,
      agentsOnly: meta.agentsOnly === true,
      sessionOnly: meta.sessionOnly === true,
      ...schemasOf(node),
    });
    return;
  }
  if (node && typeof node === "object") {
    for (const child of Object.values(node)) collect(child, found);
  }
}

/**
 * Every operation the router holds, in stable name order so a diff of the
 * command list moves only when the surface does.
 */
export function commandsFor(router: unknown): CommandDescriptor[] {
  const found: CommandDescriptor[] = [];
  collect(router, found);
  found.sort((a, b) => a.operation.localeCompare(b.operation));

  const names = new Set(found.map((command) => command.path.join(" ")));
  if (names.size !== found.length) {
    // Two dotted names collapsing to one command would silently shadow an
    // operation, so it fails here rather than at somebody's prompt.
    throw new Error("commandsFor: two operations share one command name");
  }
  return found;
}

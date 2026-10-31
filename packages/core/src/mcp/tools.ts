import type { AnyProcedure } from "@orpc/server";
import { Procedure } from "@orpc/server";
import type { OperationMeta } from "../operations/registry.ts";
import { getOperationMeta } from "../operations/registry.ts";

/**
 * One operation, as MCP sees it. `operation` is the dotted registry name and
 * the join back: the tool and the REST route stay two projections of one thing
 * (ADR-0005).
 */
export interface ToolDescriptor {
  name: string;
  operation: string;
  summary: string;
  /** GET operations only read, which lets a client offer them more freely. */
  readOnly: boolean;
  /** Whether an Agent principal may call it; the tools/list filter reads this. */
  agents: boolean;
  /** Whether only an Agent may: the same filter leaves it off a Human's list (ADR-0016). */
  agentsOnly: boolean;
  procedure: AnyProcedure;
  inputSchema: unknown;
  outputSchema: unknown;
}

/**
 * oRPC keeps a procedure's schemas on a private field, so every read of it is
 * here. A beta bump that renames it breaks this function and nothing else.
 */
function schemasOf(procedure: object): { inputSchema: unknown; outputSchema: unknown } {
  const internals = (procedure as { "~orpc"?: Record<string, unknown> })["~orpc"];
  if (!internals) throw new Error("projectTools: this oRPC procedure exposes no internals");
  // They are arrays because oRPC lets a procedure narrow its input more than
  // once; the last entry is the effective schema. Anything else means the
  // internals moved under us, which is a build failure, not a silent tool.
  const input = internals.inputSchemas;
  const output = internals.outputSchemas;
  if (!Array.isArray(input) || !Array.isArray(output) || input.length === 0) {
    throw new Error("projectTools: oRPC no longer exposes inputSchemas/outputSchemas as arrays");
  }
  return { inputSchema: input.at(-1), outputSchema: output.at(-1) };
}

/**
 * `issues.get` becomes `issues_get` and `runs.postActivity` becomes
 * `runs_post_activity`. Dots are not universally accepted by clients and
 * snake_case is what tool names look like everywhere else, so the dotted
 * registry name is lowered once, here, and `projectTools` proves the mapping
 * stays injective.
 */
export function toolName(operation: string): string {
  return operation
    .replaceAll(".", "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function collect(node: unknown, found: ToolDescriptor[]): void {
  if (node instanceof Procedure) {
    const meta = getOperationMeta(node) as OperationMeta | undefined;
    if (!meta?.mcp) return;
    found.push({
      name: toolName(meta.name),
      operation: meta.name,
      summary: meta.summary,
      readOnly: meta.method === "GET",
      agents: meta.agents === true,
      agentsOnly: meta.agentsOnly === true,
      procedure: node,
      ...schemasOf(node),
    });
    return;
  }
  if (node && typeof node === "object") {
    for (const child of Object.values(node)) collect(child, found);
  }
}

/**
 * Every operation carrying `mcp: true`, in stable name order so the CI
 * snapshot only moves when the surface does (ADR-0009).
 */
export function projectTools(router: unknown): ToolDescriptor[] {
  const found: ToolDescriptor[] = [];
  collect(router, found);
  found.sort((a, b) => a.name.localeCompare(b.name));

  const names = new Set(found.map((tool) => tool.name));
  if (names.size !== found.length) {
    // Two dotted names collapsing to one tool name would silently shadow an
    // operation, so it is a build-time failure rather than a runtime surprise.
    throw new Error("projectTools: two operations share one MCP tool name");
  }
  return found;
}

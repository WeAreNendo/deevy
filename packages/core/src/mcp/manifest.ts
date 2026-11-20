import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { router } from "../operations/index.ts";
import { projectTools } from "./tools.ts";

/** One tool as the snapshot records it: no procedure, so it serialises. */
export interface ToolManifestEntry {
  name: string;
  operation: string;
  summary: string;
  readOnly: boolean;
  inputSchema: unknown;
}

/**
 * The MCP surface as JSON, through the same Zod-to-JSON-Schema converter the
 * OpenAPI snapshot uses, so the two surfaces cannot describe one operation
 * two different ways.
 */
export async function toolManifest(): Promise<ToolManifestEntry[]> {
  const converter = new ZodToJsonSchemaConverter();
  const entries: ToolManifestEntry[] = [];
  for (const tool of projectTools(router)) {
    const [inputSchema] = converter.convert(tool.inputSchema as never, "input");
    entries.push({
      name: tool.name,
      operation: tool.operation,
      summary: tool.summary,
      readOnly: tool.readOnly,
      inputSchema,
    });
  }
  return entries;
}

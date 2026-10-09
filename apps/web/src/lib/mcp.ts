import { appURL } from "@/lib/base";

/**
 * How something reaches this deevy over MCP. The endpoint is this instance, so
 * it is read off the page rather than configured, and the recipes are the ones
 * the reference runtime itself drives (docs/harnesses.md, ADR-0018) plus the
 * shape everything else takes.
 */

/** The MCP endpoint is this deevy, so it is read off the page. */
export function mcpEndpoint(): string {
  return appURL("/mcp");
}

/** What the runtime already calls the variable holding an Agent's key. */
export const KEY_ENV = "DEEVY_AGENT_KEY";

/**
 * What stands in for the key where deevy cannot supply it and the client
 * cannot read it from the environment either.
 */
export const KEY_PLACEHOLDER = "<the key>";

export interface McpRecipe {
  /** What the tab says. */
  label: string;
  /** Where this goes: the file to write, or what the command writes for you. */
  where: string;
  /**
   * How this client spells a reference to an environment variable, where it
   * has one that works. Absent is not an oversight: Cursor documents
   * `${env:VAR}` but does not resolve it for a remote HTTP server, and
   * Copilot's CLI documents nothing, so both are told the key itself rather
   * than a reference that would be sent to deevy verbatim.
   */
  variable?: (name: string) => string;
  /** The command or the configuration, with the endpoint and the key in it. */
  snippet: (endpoint: string, secret: string) => string;
}

/** The JSON every client takes, differing in the key the server sits under. */
function serverJson(
  wrapper: string,
  endpoint: string,
  secret: string,
  server: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      [wrapper]: {
        deevy: { ...server, url: endpoint, headers: { Authorization: `Bearer ${secret}` } },
      },
    },
    null,
    2,
  );
}

/**
 * One entry per coding agent deevy knows it is reached by. The four the
 * runtime ships a recipe for come first, in the order `docs/harnesses.md`
 * lists them; the last is for everything else, because MCP is the contract and
 * a client deevy has never heard of connects the same way.
 */
export const mcpRecipes: McpRecipe[] = [
  {
    label: "Claude Code",
    where: "Run this where the Agent works, and it writes the entry itself.",
    // A shell command, so the shell expands it as the entry is written.
    variable: (name) => `$${name}`,
    snippet: (endpoint, secret) =>
      `claude mcp add --transport http deevy ${endpoint} \\\n  --header "Authorization: Bearer ${secret}"`,
  },
  {
    label: "OpenCode",
    where: "In opencode.json, beside the repository or under ~/.config/opencode.",
    variable: (name) => `{env:${name}}`,
    snippet: (endpoint, secret) =>
      serverJson("mcp", endpoint, secret, { type: "remote", enabled: true }),
  },
  {
    label: "Cursor CLI",
    where: "In ~/.cursor/mcp.json, the same file the editor reads.",
    snippet: (endpoint, secret) => serverJson("mcpServers", endpoint, secret),
  },
  {
    label: "Copilot CLI",
    where: "In ~/.copilot/mcp-config.json.",
    snippet: (endpoint, secret) => serverJson("mcpServers", endpoint, secret, { type: "http" }),
  },
  {
    label: "Anything else",
    where: "Any MCP client over streamable HTTP, with the key as a bearer token.",
    snippet: (endpoint, secret) => serverJson("mcpServers", endpoint, secret, { type: "http" }),
  },
];

/**
 * What goes in the Authorization header: the key itself while deevy still has
 * it to give, then whatever this client can be told to read instead — because
 * a key is readable once and no page can fill it in afterwards.
 */
export function secretFor(recipe: McpRecipe, key: string | null): string {
  if (key) return key;
  return recipe.variable?.(KEY_ENV) ?? KEY_PLACEHOLDER;
}

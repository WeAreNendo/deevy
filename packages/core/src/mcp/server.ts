import type { Db } from "@deevy/db";
import type {
  CallToolResult,
  InputRequiredResult,
  ListToolsResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { ServerContext } from "@modelcontextprotocol/server";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { call } from "@orpc/server";
import type { Auth } from "../auth.ts";
import { MCP_PATH } from "../auth.ts";
import { buildContext } from "../app.ts";
import type { JobQueue } from "../jobs.ts";
import type { SocketModules } from "../sockets/port.ts";
import { router } from "../operations/index.ts";
import type { AppContext } from "../operations/registry.ts";
import type { GateElicitation } from "./elicitation.ts";
import {
  createGateElicitation,
  elicitationKey,
  canElicitUrl,
  gateApprovalOperation,
  pendingGateApproval,
  principalId,
} from "./elicitation.ts";
import { toolError } from "./errors.ts";
import type { ToolDescriptor } from "./tools.ts";
import { projectTools } from "./tools.ts";

export interface DeevyMcpOptions {
  db: Db;
  /** Absent only in the Workers smoke build, which has no auth yet: every call is then 401. */
  auth?: Auth;
  /**
   * The public origin of this instance, for the RFC 9728 challenge. The
   * request's own origin is used when it is absent, which is right in
   * development and wrong behind a proxy that rewrites the host.
   */
  baseURL?: string;
  /**
   * Where a Human's browser finds this deevy, when the SPA is not served from
   * the origin above. A Gate link an Agent is handed over MCP is for a Human
   * to open, so it is built on this (`linkOrigin`, operations/shared.ts).
   */
  webURL?: string;
  /**
   * The instance secret, which signs the `requestState` a Gate elicitation
   * hands the client (mcp/elicitation.ts). Absent, a random per-process key is
   * used: correct while one process serves every round of a flow, and a clean
   * refusal rather than a forgery when it is not.
   */
  secret?: string;
  /** How long that `requestState` stays good. Tests shorten it; nothing else does. */
  stateTtlSeconds?: number;
  /**
   * Where a tool call's write nudges the deliveries it owed (jobs.ts). The
   * same queue `createApp` hands the RPC and OpenAPI surfaces: an Agent that
   * writes over MCP owes what an Agent that writes over /rpc owes.
   */
  jobs?: JobQueue;
  /**
   * The providers this deployment can speak (ADR-0024). A tool that reaches a
   * tracker — `issues_create`, `comments_create` — is refused without them, so
   * the MCP surface needs the same registry the operation surfaces get.
   */
  sockets?: SocketModules;
  /**
   * What a Socket's credentials are sealed under (`DEEVY_SECRET`, secrets.ts).
   * The registry alone reaches a tracker only for a Socket that holds nothing;
   * every real one holds a credential, and a tool opens it to act.
   */
  socketSecret?: string;
  /** Called with anything a tool call raised that the caller is not told about. */
  onError?: (error: unknown) => void;
}

/** The MCP surface: one fetch, mounted at /mcp (ADR-0005). */
export interface DeevyMcp {
  fetch: (request: Request) => Promise<Response>;
}

/** Where the request's AppContext rides to the tool callback: the SDK's own pass-through. */
const contextKey = "io.deevy/context";

/**
 * deevy's MCP server, the second of ADR-0005's three surfaces. There are no
 * protocol sessions: the SDK builds a fresh McpServer per request from the
 * factory, so any instance answers any request, which is what the Workers
 * target requires (ADR-0006). Every tool call goes through the same procedure
 * the REST route calls, so authorization happens once and in one place.
 */
export function createDeevyMcp({
  db,
  auth,
  baseURL,
  webURL,
  sockets,
  socketSecret,
  secret,
  stateTtlSeconds,
  jobs,
  onError: report = () => {},
}: DeevyMcpOptions): DeevyMcp {
  const tools = projectTools(router);
  const elicitation = createGateElicitation({
    key: elicitationKey(secret),
    ...(stateTtlSeconds === undefined ? {} : { ttlSeconds: stateTtlSeconds }),
  });
  const handler = createMcpHandler(
    (mcpRequest) => serverFor(tools, contextOf(mcpRequest.authInfo), report, elicitation),
    { responseMode: "auto", legacy: "stateless", onerror: report },
  );

  return {
    async fetch(request) {
      const origin = baseURL ?? new URL(request.url).origin;
      const context = {
        // MCP_PATH, not the API's: a token a Human granted to an MCP client
        // reaches the tools and not the ninety-four operations behind them.
        ...(await buildContext(db, auth, request.headers, origin, MCP_PATH)),
        ...(webURL ? { webURL } : {}),
        ...(jobs ? { jobs } : {}),
        ...(sockets ? { sockets } : {}),
        ...(socketSecret ? { socketSecret } : {}),
      };
      // No credential at all is an authentication answer, not a tool error:
      // the challenge is what starts the OAuth dance.
      if (!context.session) return challenge(request, baseURL);
      return handler.fetch(request, {
        authInfo: {
          // The SDK's AuthInfo is a pass-through envelope; deevy's own answer
          // to "who is calling" is the Principal already inside the context.
          // `clientId` carries it because that is the field the requestState
          // codec's `bind` can reach (mcp/elicitation.ts).
          token: "",
          clientId: principalId(context),
          scopes: [],
          extra: { [contextKey]: context },
        },
      });
    },
  };
}

/** The AppContext this request resolved to, put there by `fetch` above. */
function contextOf(authInfo: { extra?: Record<string, unknown> } | undefined): AppContext {
  const found = authInfo?.extra?.[contextKey];
  if (!found) throw new Error("createDeevyMcp: the request reached MCP with no deevy context");
  return found as AppContext;
}

/**
 * One request's server. Every projected tool is registered for every caller:
 * what a caller may do is decided by `authorize()` inside the procedure, never
 * by which tools were registered. `tools/list` is then narrowed to what this
 * caller could plausibly use, which is a courtesy to the model's context
 * window and nothing more (docs/plans/m2.md).
 */
function serverFor(
  tools: ToolDescriptor[],
  context: AppContext,
  report: (error: unknown) => void,
  elicitation: GateElicitation,
): McpServer {
  const server = new McpServer(
    { name: "deevy", version: "0.0.0" },
    // The seam verifies an echoed `requestState` before the handler runs, and
    // refuses one minted for another principal or past its expiry with the
    // protocol's own -32602 (mcp/elicitation.ts).
    { requestState: { verify: elicitation.verify } },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.summary,
        inputSchema: tool.inputSchema as StandardSchemaWithJSON,
        annotations: { readOnlyHint: tool.readOnly },
      },
      (input: unknown, ctx: ServerContext) =>
        runTool(tool, input, context, report, elicitation, ctx),
    );
  }

  // Display only. The tools left out here stay callable, and are refused, or
  // not, by exactly the same middleware as every other surface (ADR-0005).
  const visible = visibleTools(tools, context);
  server.server.setRequestHandler("tools/list", () => ({
    tools: visible.map((tool) => ({
      name: tool.name,
      description: tool.summary,
      inputSchema: inputSchemaJson(server, tool),
      annotations: { readOnlyHint: tool.readOnly },
    })),
  }));
  return server;
}

type AdvertisedSchema = ListToolsResult["tools"][number]["inputSchema"];

/**
 * The JSON Schema `tools/list` advertises for a tool. The McpServer memoises
 * this conversion at registration, so asking it keeps the schema a client is
 * shown and the schema its arguments are validated against one and the same.
 * It is the only McpServer internal this file reaches for; a rename breaks the
 * build here and nowhere else, the way `schemasOf` isolates oRPC's
 * (mcp/tools.ts).
 */
function inputSchemaJson(server: McpServer, tool: ToolDescriptor): AdvertisedSchema {
  const converted = server.toolInputSchemaJson(tool.name);
  return (converted ?? { type: "object", properties: {} }) as AdvertisedSchema;
}

/**
 * What this caller is offered. An Agent is not shown the tools it is refused,
 * a Human is not shown the tools that are an Agent's alone (ADR-0016), and a
 * caller who is no Member of this Workspace is offered nothing, because a
 * seventy-tool list it cannot call costs it its context window for nothing.
 */
export function visibleTools(tools: ToolDescriptor[], context: AppContext): ToolDescriptor[] {
  const member = context.member;
  if (!member || !context.workspace || member.suspendedAt) return [];
  return member.kind === "agent"
    ? tools.filter((tool) => tool.agents)
    : tools.filter((tool) => !tool.agentsOnly);
}

/** One tool call, which is one call of the very same procedure /api and /rpc call. */
async function runTool(
  tool: ToolDescriptor,
  input: unknown,
  context: AppContext,
  report: (error: unknown) => void,
  elicitation: GateElicitation,
  ctx: ServerContext,
): Promise<CallToolResult | InputRequiredResult> {
  try {
    const output = await call(tool.procedure, input, { context });
    // A Gate nobody has ruled on yet is the one answer that is not an answer:
    // the client is sent to deevy and retries, and the retry reads the
    // decision row rather than anything the client carried back.
    if (tool.operation === gateApprovalOperation) {
      const waiting = pendingGateApproval(output);
      // Only to a client that can take one: the answer already carries the URL,
      // and offering an elicitation to a client that declared none is refused
      // by the SDK after this returns, turning work that succeeded into an
      // error (elicitation.ts, canElicitUrl).
      if (waiting && canElicitUrl(ctx)) return elicitation.ask(waiting, ctx);
    }
    // Dates and the like become what the wire carries before the model reads
    // them, so the text and the structured content cannot disagree.
    const json = JSON.parse(JSON.stringify(output ?? null)) as unknown;
    return {
      content: [{ type: "text", text: JSON.stringify(json, null, 2) }],
      ...(isPlainObject(json) ? { structuredContent: json } : {}),
    };
  } catch (error) {
    return toolError(error, report);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * RFC 9728: a 401 naming where the Protected Resource Metadata lives is what
 * makes an MCP client start the OAuth dance rather than simply fail.
 */
function challenge(request: Request, baseURL?: string): Response {
  const base = (baseURL ?? new URL(request.url).origin).replace(/\/+$/, "");
  // RFC 9728 forms the metadata URL by inserting the well-known segment
  // between the host and the resource's own path, so a resource at /mcp is
  // described at /.well-known/oauth-protected-resource/mcp. A client that
  // derives the URL instead of reading this header looks there, so slice 7
  // has to serve the document at this exact path.
  const metadata = `${base}/.well-known/oauth-protected-resource${MCP_PATH}`;
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description: "This MCP endpoint needs an Agent's API key or an access token",
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${metadata}"`,
      },
    },
  );
}

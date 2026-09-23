/**
 * The deevy tools a session may call, by the names deevy gives them.
 *
 * Listed rather than wildcarded on purpose: deevy gaining a nineteenth tool
 * must not silently widen what this program may do, and the list is short
 * enough to read as a description of the job (docs/agent-loop.md). Every name
 * is in `packages/core/mcp-tools.json`.
 *
 * `runs_checkout` is not here and could not be: it is not a tool at all. The
 * credential a Run clones with is the supervisor's, and a credential in a
 * model's context is a credential in a transcript (ADR-0014).
 *
 * The proxy enforces this list (src/proxy.ts): `tools/list` is filtered to it
 * and `tools/call` on anything else is refused before it reaches deevy. So the
 * harness's own permission syntax is a second fence around the deevy tools,
 * never the only one (docs/plans/harnesses.md).
 */
export const deevyToolNames: ReadonlyArray<string> = [
  "inbox_list",
  "runs_list",
  "runs_get",
  "runs_start",
  "issues_get",
  "issues_create",
  "comments_create",
  "runs_post_activity",
  "gates_request",
  "gates_get",
  "pulls_open",
  "links_add",
  "runs_finish",
];

import { isAppPath, serveSpaUnder, underBase } from "@deevy/adapters/workers";
import { relaySignInCallback } from "@deevy/core";
import { isSlug, lookup, RESERVED_SLUGS, type DirectoryEntry } from "./directory.ts";
import type { HostedBindings, HostedEnv } from "./env.ts";
import { VERSION } from "./version.ts";
import type { WorkspaceObject } from "./workspace.ts";

/**
 * The hosted Worker's front door (docs/plans/hosted.md, "The hosted Worker").
 * One host, `app.deevy.dev`, and the first segment of the path decides:
 *
 * - `/<slug>/…` is a Workspace. The SPA's pages and files come from the
 *   Worker's own assets, so no object wakes for a script; the app's paths —
 *   `/api`, `/rpc`, `/mcp`, `/hooks`, `/healthz`, `/.well-known` — go to the
 *   Workspace's object, which runs deevy.
 * - `/.well-known/<document>/<slug>…` is a Workspace's OAuth discovery, which
 *   RFC 8414 and RFC 9728 put at the root of the host (ADR-0029).
 * - `/auth/…` is the sign-in relay every provider's App calls back to (ADR-0030).
 * - Everything else is the console's, when the platform has one bound.
 *
 * Nothing here wakes an object for a slug the directory does not know.
 */
export async function route(
  request: Request,
  bindings: HostedBindings,
  hosted: HostedEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // How a deploy proves which version served a request: one pinned with
  // Cloudflare's version override header reaches a version deployed at 0%,
  // and the Worker version's id says it did, even for a redeploy of the same
  // release (deevy-cloud's rollout); the release says which one it is.
  if (path === "/healthz") {
    return Response.json({
      ok: true,
      version: VERSION ?? null,
      versionId: bindings.CF_VERSION_METADATA?.id ?? null,
    });
  }

  const discovery =
    /^\/\.well-known\/(oauth-authorization-server|oauth-protected-resource|openid-configuration)\/([^/]+)(\/.*)?$/.exec(
      path,
    );
  if (discovery) {
    const entry = await lookup(bindings.DIRECTORY, discovery[2] ?? "");
    return entry ? toWorkspace(request, bindings, hosted, entry) : notFound();
  }

  const first = path.split("/")[1] ?? "";
  if (first === "auth") {
    return relaySignInCallback(request, path.slice("/auth".length), {
      secret: hosted.relaySecret,
      // A browser carrying a code goes only to a Workspace the directory knows,
      // at exactly the URL its Better Auth lives at, or to the console's.
      allows: async (target) => {
        if (hosted.consoleAuthURL && target === hosted.consoleAuthURL) return true;
        const match = new RegExp(`^${escape(hosted.origin)}/([^/]+)/api/auth$`).exec(target);
        if (!match?.[1]) return false;
        return (await lookup(bindings.DIRECTORY, match[1]))?.status === "active";
      },
    });
  }

  if (first === "" || RESERVED_SLUGS.has(first) || !isSlug(first)) {
    return bindings.CONSOLE ? bindings.CONSOLE.fetch(request) : notFound();
  }

  const entry = await lookup(bindings.DIRECTORY, first);
  if (!entry) return notFound();
  if (entry.status === "suspended") return suspendedPage();

  const base = `/${first}`;
  const inner = underBase(path, base);
  if (inner === null) return notFound();
  if (isAppPath(inner)) return toWorkspace(request, bindings, hosted, entry);
  return (await serveSpaUnder(request, base, bindings.ASSETS)) ?? notFound();
}

/** The object a Workspace's key names, in the jurisdiction every one is created in. */
export function workspaceStub(
  bindings: HostedBindings,
  hosted: HostedEnv,
  key: string,
): DurableObjectStub<WorkspaceObject> {
  const namespace = (
    hosted.jurisdiction
      ? bindings.WORKSPACES.jurisdiction(hosted.jurisdiction as DurableObjectJurisdiction)
      : bindings.WORKSPACES
  ) as DurableObjectNamespace<WorkspaceObject>;
  return namespace.get(namespace.idFromName(key));
}

function toWorkspace(
  request: Request,
  bindings: HostedBindings,
  hosted: HostedEnv,
  entry: DirectoryEntry,
): Promise<Response> {
  if (entry.status === "suspended") return Promise.resolve(suspendedPage());
  return workspaceStub(bindings, hosted, entry.key).fetch(request);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function page(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${body}</p>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function notFound(): Response {
  return page(404, "Not found", "There is no Workspace here.");
}

/**
 * What a suspended Workspace is, in the sentence the console opens its own line
 * about one with, as apps/docs/content/cloud/support.md quotes it. Short enough
 * for a WebSocket's close reason, which is where an open tab hears it
 * (workspace.ts).
 */
export const SUSPENDED = "This Workspace is suspended: nobody can use it until it is resumed.";

/**
 * What a suspended Workspace says to whoever reaches it, here and from its
 * object (workspace.ts). The directory knows only that it is suspended, not
 * who did it: its owner deleting it, which they can undo from the console for
 * 30 days, or deevy Cloud, which only support can undo. So after `SUSPENDED`
 * it says what is true of both, sending the visitor to the owner and the owner
 * to the console, whose page on the Workspace says which, or to support.
 */
export function suspendedPage(): Response {
  return page(
    403,
    "Workspace suspended",
    `${SUSPENDED} Ask its owner, who can see why in <a href="/">the console</a> or write to <a href="mailto:support@deevy.dev">support@deevy.dev</a>.`,
  );
}

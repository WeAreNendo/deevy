/**
 * Serving the SPA for a deployment that lives under a path, the same way on
 * every runtime (docs/plans/hosted.md). Web-standard, so the Node entry, the
 * Worker and the many-Workspaces Worker share it.
 *
 * The built index carries `<base href="/" />` and names its assets relative to
 * it (apps/web/vite.config.ts), so one build serves the root of a host as it
 * is and a path once this rewrites the element: `/acme/` makes `./assets/x.js`
 * mean `/acme/assets/x.js`, and the SPA reads its base off the same element
 * (apps/web/src/lib/base.ts).
 */

/** The index, saying where on its origin this deevy lives. */
export function withBaseHref(html: string, base: string): string {
  if (!base) return html;
  const href = `${base.replace(/[&"<>]/g, "")}/`;
  return html.replace(/<base href="\/"\s*\/?>/, `<base href="${href}" />`);
}

/**
 * What the app answers rather than the SPA, as paths under the base. The same
 * list as the Worker's `run_worker_first`, which `worker-routes.test.ts` holds
 * against the routes `createApp` mounts.
 */
export const APP_PREFIXES = ["/api/", "/rpc/", "/hooks/", "/.well-known/"] as const;
export const APP_PATHS = ["/healthz", "/mcp"] as const;

/** Whether a path under the base is one of the app's own. */
export function isAppPath(path: string): boolean {
  return (
    (APP_PATHS as readonly string[]).includes(path) ||
    APP_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

/**
 * The part of a pathname under the base: `/assets/x.js` from
 * `/acme/assets/x.js`, `/` from `/acme`, and null for a path outside it.
 */
export function underBase(pathname: string, base: string): string | null {
  if (!base) return pathname;
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}

/** Something that answers a request for a static file, as Workers' `ASSETS` binding does. */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * The SPA under a base, from a store that holds it at its own root: the file
 * when there is one, and the index — saying where it lives — for every route
 * the SPA owns. Null for a path outside the base, which is somebody else's.
 */
export async function serveSpaUnder(
  request: Request,
  base: string,
  assets: AssetFetcher,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = underBase(url.pathname, base);
  if (path === null) return null;
  const inner = new URL(url);
  inner.pathname = path;
  const response = await assets.fetch(new Request(inner, request));
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  // The index, whichever route asked for it: rewritten, and never kept, since
  // it is what names the assets of the version that is running.
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-cache");
  return new Response(withBaseHref(await response.text(), base), {
    status: response.status,
    headers,
  });
}

/**
 * Where this deevy lives on its origin, read off the page's `<base href>`.
 *
 * The server writes the element into the index it serves: `/` at the root of a
 * host, which is every deployment until one lives under a path, and `/acme/`
 * for a hosted Workspace at `app.deevy.dev/acme` or a deevy an operator serves
 * at `company.com/acme` (docs/plans/hosted.md). The SPA's own assets are
 * relative to it, and everything the SPA calls or links to is built here, so
 * no other file has to know. With no element — a test, the dev server — it is
 * the root.
 */
export function basePath(): "" | `/${string}` {
  if (typeof document === "undefined") return "";
  const href = document.querySelector("base")?.getAttribute("href");
  if (!href) return "";
  try {
    // A pathname always starts with a slash, so what is left is nothing or a path.
    return new URL(href, window.location.origin).pathname.replace(/\/+$/, "") as "" | `/${string}`;
  } catch {
    return "";
  }
}

/** A path on this deevy, under its base: `/rpc` becomes `/acme/rpc`. */
export function withBase(path: `/${string}`): `/${string}` {
  return `${basePath()}${path}`;
}

/**
 * The same, as an absolute URL on the origin this browser is on. Any path, so
 * a site-relative one the server built — an invitation's — and the empty one,
 * which is this deevy itself.
 */
export function appURL(path: string): string {
  return `${window.location.origin}${basePath()}${path}`;
}

/** Where in the app a pathname is: the part after the base, `/invite/…` from `/acme/invite/…`. */
export function inApp(pathname: string): string {
  const base = basePath();
  if (!base) return pathname;
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

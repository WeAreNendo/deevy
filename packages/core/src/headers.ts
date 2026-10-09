import type { MiddlewareHandler } from "hono";

/**
 * What a page deevy serves may run, load and be framed by.
 *
 * Every page runs only the scripts deevy shipped, from deevy's own origin: no
 * inline script, no `eval`, nothing from a CDN. A hosted deevy puts every
 * Workspace under a path on one origin, so a script that got onto one
 * Workspace's page would act in every other Workspace its visitor is signed
 * in to; this is the line that keeps a tracker's text text.
 *
 * Styles allow inline on purpose. Three libraries the SPA is built from insert
 * a `<style>` element as they run — Base UI's scrollbar rule, sonner's whole
 * stylesheet, next-themes' guard against transitions while the theme changes —
 * and a hash per library version would turn every upgrade into a broken page.
 * An inline style can restyle a page but run nothing, which is the trade
 * GitHub's own policy makes.
 *
 * `img-src https:` because an avatar comes from whichever provider somebody
 * signed in with, and a Proposal may show an image from anywhere; `form-action`
 * names GitHub because creating a GitHub App is a form the browser posts to
 * github.com with the manifest (components/connect-github.tsx). Nothing frames
 * deevy: a Gate's Approve is the button a frame would want to steal.
 */
export const pagePolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The headers every page carries, the SPA's and the few the server writes
 * itself (an unsubscribe, a confirmation). The Worker's static assets carry the
 * same through `apps/web/public/_headers`, which `headers.test.ts` holds to
 * this object, because the asset handler answers before any code of deevy's
 * runs.
 */
export const pageHeaders: Readonly<Record<string, string>> = {
  "Content-Security-Policy": pagePolicy,
  // For a browser too old to read frame-ancestors.
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Everything that is not a page — an API answer, an event stream, a redirect,
 * a script or a stylesheet — is never to be read as one: opened on its own, it
 * runs nothing, loads nothing and frames nowhere.
 */
export const dataHeaders: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** Where the OpenAPI reference page lives: `docsPath` under the API's prefix (app.ts). */
export const DOCS_PATH = "/api/docs";

/**
 * Where the reference page's viewer comes from: oRPC's default for Scalar,
 * which `OpenAPIReferenceHandlerPlugin` writes as the page's one script tag.
 */
export const SCALAR_SCRIPT = "https://cdn.jsdelivr.net/npm/@scalar/api-reference";

/**
 * The reference page's own policy. It is the one page deevy serves that runs a
 * script from somewhere else — Scalar, from jsDelivr — and an inline one that
 * hands it the document, so it names that script by its address and the
 * inline one by its hash, and nothing else may run. Scalar writes its own
 * styles and fetches its fonts from its own host; what it calls is deevy.
 */
export async function docsPolicy(html: string): Promise<string> {
  const hashes = await Promise.all(inlineScripts(html).map(sha256));
  return [
    "default-src 'none'",
    ["script-src", SCALAR_SCRIPT, ...hashes.map((hash) => `'sha256-${hash}'`)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.scalar.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The bodies of the `<script>` elements that carry no `src`. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
}

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...digest));
}

/**
 * The headers every response from `createApp` leaves with, chosen by what it
 * is: a page gets `pageHeaders` (the reference page its own policy), anything
 * else `dataHeaders`. Registered on every path before anything else, so on
 * Node it covers the SPA that `mountSpa` adds after the fact too. A header a
 * handler set on purpose is left as it is.
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const page = (c.res.headers.get("content-type") ?? "").startsWith("text/html");
  const headers = !page
    ? dataHeaders
    : c.req.path === DOCS_PATH
      ? {
          ...pageHeaders,
          "Content-Security-Policy": await docsPolicy(await c.res.clone().text()),
        }
      : pageHeaders;
  const missing = Object.entries(headers).filter(([name]) => !c.res.headers.has(name));
  if (missing.length === 0) return;
  // A response somebody else built — a fetch passed straight through — may
  // have headers that cannot be changed, so it is copied once before writing.
  try {
    for (const [name, value] of missing) c.res.headers.set(name, value);
  } catch {
    c.res = new Response(c.res.body, c.res);
    for (const [name, value] of missing) c.res.headers.set(name, value);
  }
};

import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono, MiddlewareHandler, Schema } from "hono";

/**
 * How long a browser may keep a file without asking again. Vite names what it
 * builds into `assets/` by its content, so one name never changes meaning and
 * those are kept for good; everything else — `index.html` above all, which is
 * what names them — is asked for again each time. With no header at all a
 * browser guesses from Last-Modified, and an upgrade reached nobody until the
 * guess ran out.
 */
function cacheControlFor(path: string): string {
  return path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

/**
 * The file `serve` answers with, carrying how long it may be kept. Set on the
 * Response it returns: its own `onFound` runs after that Response is built,
 * so a header set there reaches nobody.
 */
function cached(serve: MiddlewareHandler, cacheControl: (path: string) => string) {
  const middleware: MiddlewareHandler = async (c, next) => {
    const served = await serve(c, next);
    if (served instanceof Response) served.headers.set("Cache-Control", cacheControl(c.req.path));
    return served;
  };
  return middleware;
}

/**
 * Serves a built single-page app from `dir`: real files first, `index.html`
 * for everything else so client-side routes deep-link.
 */
export function mountSpa<E extends Env, S extends Schema, P extends string>(
  app: Hono<E, S, P>,
  dir: string,
): void {
  app.use("*", cached(serveStatic({ root: dir }), cacheControlFor));
  app.get(
    "*",
    cached(serveStatic({ root: dir, path: "index.html" }), () => "no-cache"),
  );
}

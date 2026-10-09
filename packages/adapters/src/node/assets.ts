import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono, MiddlewareHandler, Schema } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { underBase, withBaseHref } from "../spa.ts";

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
 *
 * Under `base` — the path of this deployment's URL, empty at the root of a
 * host — the files are found by the part of the path after it, and the index
 * says where it lives in its `<base href>` (../spa.ts, docs/plans/hosted.md).
 */
export function mountSpa<E extends Env, S extends Schema, P extends string>(
  app: Hono<E, S, P>,
  dir: string,
  base = "",
): void {
  if (!base) {
    app.use("*", cached(serveStatic({ root: dir }), cacheControlFor));
    app.get(
      "*",
      cached(serveStatic({ root: dir, path: "index.html" }), () => "no-cache"),
    );
    return;
  }
  const inner = (path: string) => underBase(path, base) ?? path;
  const files = cached(serveStatic({ root: dir, rewriteRequestPath: inner }), (path) =>
    cacheControlFor(inner(path)),
  );
  app.use(`${base}/*`, async (c, next) => {
    // The index is never served as a file here: as one, it would still say it
    // lives at the root.
    const path = inner(c.req.path);
    if (path === "/" || path === "/index.html") return next();
    return files(c, next);
  });
  // Read once: it changes only with the build, which is a restart.
  let index: string | undefined;
  const serveIndex: MiddlewareHandler = async (c) => {
    index ??= withBaseHref(await readFile(join(dir, "index.html"), "utf8"), base);
    c.header("Cache-Control", "no-cache");
    return c.html(index);
  };
  app.get(base, serveIndex);
  app.get(`${base}/*`, serveIndex);
}

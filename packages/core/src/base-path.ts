/**
 * Where on its origin a deployment lives: the path of its URL, without the
 * trailing slash, and the empty string when it has none — which is every
 * deployment that sits at the root of its host, and so what changes nothing.
 *
 * One deployment may live under a path (docs/plans/hosted.md): a hosted
 * Workspace at `app.deevy.dev/acme`, or a self-hosted deevy an operator serves
 * at `company.com/deevy`. The path is not configured on its own; it is the
 * path of `BETTER_AUTH_URL`, because that URL is already the base of every
 * route and every link, and a second setting could only disagree
 * with it (ADR-0029).
 */
export function basePathOf(url: string | undefined): BasePath {
  if (!url) return "";
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "";
  }
  // A URL's pathname always starts with a slash, so what is left is either
  // nothing or a path.
  return pathname.replace(/\/+$/, "") as BasePath;
}

/** A deployment's path: nothing, or a path that starts with a slash. */
export type BasePath = "" | `/${string}`;

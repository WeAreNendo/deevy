/**
 * Where on its origin a deployment lives: the path of its URL, without the
 * trailing slash, and the empty string when it has none — which is every
 * deployment that sits at the root of its host, and so what changes nothing.
 *
 * One deployment may live under a path (docs/plans/hosted.md): a hosted
 * Workspace at `app.deevy.dev/acme`, or a self-hosted deevy an operator serves
 * at `company.com/deevy`. The path is not configured on its own; it is the
 * path of `BETTER_AUTH_URL`, because that URL is already the issuer, the base
 * of every resource and every link, and a second setting could only disagree
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

/**
 * Where an RFC 8414 or RFC 9728 document about `url` lives: the well-known
 * segment goes between the host and the path, so the authorization server at
 * `https://app.deevy.dev/acme` is described at
 * `https://app.deevy.dev/.well-known/oauth-authorization-server/acme`, and a
 * resource at `…/acme/mcp` at `…/.well-known/oauth-protected-resource/acme/mcp`.
 */
export function wellKnownURL(url: string, document: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}/.well-known/${document}${basePathOf(url)}`;
}

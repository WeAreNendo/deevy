/**
 * The authorization a sign-in on this page is partway through: the signed
 * parameters of the page's query, as `oauthProviderClient` sends them with
 * every request it makes (lib/auth.ts), or nothing on a page that is not one.
 * `DevSignIn` posts with its own `fetch`, so it sends this itself.
 */
export function authorizationInProgress(search = window.location.search): string | undefined {
  const params = new URLSearchParams(search);
  const named = new Set(params.getAll("ba_param"));
  if (!params.has("sig") || named.size === 0) return undefined;
  const signed = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === "sig" || key === "ba_param" || named.has(key)) signed.append(key, value);
  }
  return signed.toString();
}

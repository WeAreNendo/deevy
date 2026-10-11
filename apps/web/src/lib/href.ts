/**
 * A link to somewhere a tracker, an Agent or a tool named — a record's page, a
 * pull request an Agent pointed at, a GitHub App's page — as an `href`: the
 * address as given when it is a web page, and nothing at all otherwise.
 *
 * A `javascript:` address on an anchor runs in deevy's page the moment
 * somebody clicks it, with their session, and every one of these addresses is
 * somebody else's text: a Link is whatever an Agent sent `links.add`, and a
 * record's URL is whatever its tracker's payload said. The page's policy
 * refuses such a script too (packages/core/src/headers.ts); this keeps the
 * link from being drawn at all, so nothing depends on one line of defence.
 * An anchor with no `href` is not a link, which is the honest thing to show.
 */
export function webHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

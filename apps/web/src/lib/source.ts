/** Where deevy's source lives. */
export const REPOSITORY = "https://github.com/WeAreNendo/deevy";

/**
 * The source of the version an instance runs. deevy is AGPL-3.0 (ADR-0002),
 * which asks that whoever uses it over a network be offered the source of the
 * version they use, so this is that release's tag — `v<version>`, as
 * `.github/workflows/changesets.yml` writes it — or the repository itself when
 * the build did not say which version it is.
 */
export function sourceOf(version: string | null | undefined): string {
  return version ? `${REPOSITORY}/tree/v${encodeURIComponent(version)}` : REPOSITORY;
}

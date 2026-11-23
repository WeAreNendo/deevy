/**
 * The signed-out card's buttons, in the order the server sent them — the
 * operator's `DEEVY_SIGN_IN_ORDER`, else deevy's default, which leads with
 * what most teams sign in with — except that the one this browser used last
 * comes first. A deployment offers four at most (GitHub, Google, Microsoft
 * and single sign-on, docs/plans/simplify.md slice 10), so every one shows.
 *
 * `lastUsed` names a provider only when it is still offered and is not the
 * only one: a badge on the only way in says nothing.
 */
export function arrangeSignIn<P extends { id: string }>(
  providers: readonly P[],
  lastUsedId: string | null,
): { shown: P[]; lastUsed: string | null } {
  const last = providers.length > 1 ? providers.find((p) => p.id === lastUsedId) : undefined;
  const shown = last ? [last, ...providers.filter((p) => p !== last)] : [...providers];
  return { shown, lastUsed: last?.id ?? null };
}

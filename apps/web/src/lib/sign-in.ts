/** How many sign-in buttons show before "More ways to sign in". */
const SHOWN = 3;
/** Up to this many, every button shows: a disclosure hiding one is a wall of its own. */
const ALL_WITHOUT_MORE = 4;

/**
 * The signed-out card's buttons, in the order the server sent them — the
 * operator's `DEEVY_SIGN_IN_ORDER`, else deevy's default, which leads with
 * what most teams sign in with — except that the one this browser used last
 * comes first. Past four, three show and the rest wait behind a disclosure,
 * the single sign-on last among them: its name is whatever the operator
 * called it, so it takes a row of its own. An operator who wants it in view
 * lists it early, and it is then one of the three.
 *
 * `lastUsed` names a provider only when it is still offered and is not the
 * only one: a badge on the only way in says nothing.
 */
export function arrangeSignIn<P extends { id: string }>(
  providers: readonly P[],
  lastUsedId: string | null,
): { shown: P[]; more: P[]; lastUsed: string | null } {
  const last = providers.length > 1 ? providers.find((p) => p.id === lastUsedId) : undefined;
  const ordered = last ? [last, ...providers.filter((p) => p !== last)] : [...providers];
  const lastUsed = last?.id ?? null;
  if (ordered.length <= ALL_WITHOUT_MORE) return { shown: ordered, more: [], lastUsed };
  const rest = ordered.slice(SHOWN);
  return {
    shown: ordered.slice(0, SHOWN),
    more: [...rest.filter((p) => p.id !== "oidc"), ...rest.filter((p) => p.id === "oidc")],
    lastUsed,
  };
}

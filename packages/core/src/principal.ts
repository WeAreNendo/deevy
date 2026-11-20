import { apiKeyPrefix, bearerToken } from "./auth.ts";
import type { Auth, Session } from "./auth.ts";
import type { Principal } from "./operations/registry.ts";

export interface ResolvePrincipalOptions {
  /** Absent only in the Workers smoke build, which has no auth yet. */
  auth?: Auth;
  headers: Headers;
}

export interface ResolvedPrincipal {
  principal: Principal;
  session: Session | null;
}

const anonymous: ResolvedPrincipal = { principal: { kind: "anonymous" }, session: null };

/**
 * How a request authenticated, decided once per request: a Human's session
 * cookie, an Agent's key, or nobody. deevy mints no other credential (ADR-0035),
 * so a bearer that is not a deevy key is nobody without being looked up.
 */
export async function resolvePrincipal({
  auth,
  headers,
}: ResolvePrincipalOptions): Promise<ResolvedPrincipal> {
  if (!auth) return anonymous;

  // A bearer is answered by the key alone. Falling back to the cookie when the
  // key fails would let a Human's browser session answer for a bad key, so a
  // request with a bearer is either that key's Agent or nobody.
  const bearer = bearerToken(headers);
  if (bearer) return bearer.startsWith(apiKeyPrefix) ? await fromApiKey(auth, bearer) : anonymous;

  const session = await auth.api.getSession({ headers });
  return session ? { principal: { kind: "cookie" }, session } : anonymous;
}

/**
 * An Agent's key stands for its Member, so the resolved session names the key's
 * user the way a cookie session names a Human. The key itself never reaches the
 * context: only its id, for the Event log and for revocation.
 *
 * Only an Agent's: a key that names a Human — one minted before Better Auth's
 * key routes were closed, or by anything that reaches the plugin some other
 * way — is nobody, so no Human holds a credential that acts for them while
 * they are away, and no Gate can be ruled by one (ADR-0010, ADR-0035).
 */
async function fromApiKey(auth: Auth, key: string): Promise<ResolvedPrincipal> {
  const verified = await auth.api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) return anonymous;
  const context = await auth.$context;
  const user = await context.internalAdapter.findUserById(verified.key.referenceId);
  if (!user || (user as { kind?: unknown }).kind !== "agent") return anonymous;
  return {
    principal: { kind: "api_key", keyId: verified.key.id },
    session: {
      user,
      session: {
        // Not a session row: nothing persists it, and the token is the key's
        // id rather than the key, so the secret stays out of the context.
        id: verified.key.id,
        userId: user.id,
        token: verified.key.id,
        createdAt: verified.key.createdAt,
        updatedAt: verified.key.updatedAt,
        expiresAt: verified.key.expiresAt ?? new Date(Date.now() + 86_400_000),
      },
    } as Session,
  };
}

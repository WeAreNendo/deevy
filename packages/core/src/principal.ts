import { verifyJwsAccessToken } from "better-auth/oauth2";
import type { ResourcePath } from "./auth.ts";
import { AUTH_BASE_PATH, apiKeyPrefix, bearerToken } from "./auth.ts";
import type { Auth, Session } from "./auth.ts";
import type { Principal } from "./operations/registry.ts";

/**
 * How the JSON Web Key Set is fetched when an OAuth access token is verified.
 * requireMcpAuth self-fetches /jwks over the network and fails when the
 * authorization server and the resource server are the same process
 * (better-auth#10888), so slice 7 verifies the token itself and dispatches this
 * into `auth.handler` in process (docs/plans/m2.md).
 */
export type JwksFetch = (request: Request) => Promise<Response>;

export interface ResolvePrincipalOptions {
  /** Absent only in the Workers smoke build, which has no auth yet. */
  auth?: Auth;
  headers: Headers;
  /**
   * The origin this instance answers as, which is the OAuth issuer and the
   * stem of the MCP resource identifier (auth.ts). An access token is refused
   * without it: there would be nothing to check the audience against.
   */
  baseURL?: string;
  /**
   * The surface being reached, as a path under `baseURL`: an access token is
   * audience-bound to one resource, and presenting an MCP token to the API or
   * an API token to MCP is not a caller this instance knows (auth.ts).
   *
   * Required, and required of `buildContext` too. It had a default on both for
   * one review round, and they disagreed — one defaulted to the API and the
   * other to MCP — which is exactly the shape of bug that ends with a surface
   * accepting the wrong audience because somebody left an argument off.
   */
  resourcePath: ResourcePath;
  jwksFetch?: JwksFetch;
}

export interface ResolvedPrincipal {
  principal: Principal;
  session: Session | null;
}

const anonymous: ResolvedPrincipal = { principal: { kind: "anonymous" }, session: null };

/**
 * How a request authenticated, decided once per request (docs/plans/m2.md).
 * An Agent's API key and a Human MCP client's OAuth token arrive on the same
 * header at the same endpoint, so the arms are ordered and the deevy key prefix
 * is the discriminator.
 */
export async function resolvePrincipal({
  auth,
  headers,
  baseURL,
  resourcePath,
  jwksFetch,
}: ResolvePrincipalOptions): Promise<ResolvedPrincipal> {
  if (!auth) return anonymous;

  // A bearer is answered by the bearer arms alone. Falling back to the cookie
  // when the credential fails would let a Human's browser session answer for a
  // bad key, so a request with a bearer is either that bearer or nobody.
  const bearer = bearerToken(headers);
  if (bearer) {
    return bearer.startsWith(apiKeyPrefix)
      ? await fromApiKey(auth, bearer)
      : await fromAccessToken(auth, bearer, baseURL, resourcePath, jwksFetch);
  }

  const session = await auth.api.getSession({ headers });
  return session ? { principal: { kind: "cookie" }, session } : anonymous;
}

/**
 * An Agent's key stands for its Member, so the resolved session names the key's
 * user the way a cookie session names a Human. The key itself never reaches the
 * context: only its id, for the Event log and for revocation.
 */
async function fromApiKey(auth: Auth, key: string): Promise<ResolvedPrincipal> {
  const verified = await auth.api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) return anonymous;
  const context = await auth.$context;
  const user = await context.internalAdapter.findUserById(verified.key.referenceId);
  if (!user) return anonymous;
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

/**
 * One JWKS cache per auth instance. `verifyJwsAccessToken` caches a key set
 * fetched through a function only under a stable object the caller supplies,
 * because a fresh closure per request has no identity of its own; without one
 * every call would re-dispatch. Weak, so a test's instance is collectable.
 */
const jwksCacheKeys = new WeakMap<Auth, object>();

/** Claims the OAuth provider puts on an access token that deevy reads. */
interface AccessTokenClaims {
  sub?: unknown;
  scope?: unknown;
  client_id?: unknown;
  azp?: unknown;
  cnf?: unknown;
  jti?: unknown;
  exp?: unknown;
  iat?: unknown;
}

/**
 * A Human MCP client's OAuth access token (docs/plans/m2.md). deevy is both
 * the authorization server and the resource server, so `requireMcpAuth` is
 * never called: it fetches `/jwks` over the network and deadlocks when the two
 * are one process (better-auth#10888), which is exactly this shape and M3's
 * single Worker. The key set is dispatched into `auth.handler` in process
 * instead, which is web-standard and needs no listening socket.
 *
 * The token stands for the Human who consented, so the resolved session names
 * that user the way a cookie session does. RFC 8707: a token minted for a
 * different `resource` fails the audience check and is nobody.
 */
async function fromAccessToken(
  auth: Auth,
  token: string,
  baseURL: string | undefined,
  resourcePath: ResourcePath,
  jwksFetch?: JwksFetch,
): Promise<ResolvedPrincipal> {
  const issuer = baseURL?.replace(/\/+$/, "");
  if (!issuer) return anonymous;
  const dispatch = jwksFetch ?? ((request: Request) => auth.handler(request));
  let cacheKey = jwksCacheKeys.get(auth);
  if (!cacheKey) {
    cacheKey = {};
    jwksCacheKeys.set(auth, cacheKey);
  }

  let claims: AccessTokenClaims;
  try {
    claims = (await verifyJwsAccessToken(token, {
      jwksFetch: async () => {
        const response = await dispatch(new Request(`${issuer}${AUTH_BASE_PATH}/jwks`));
        return response.ok ? ((await response.json()) as never) : undefined;
      },
      jwksCacheKey: cacheKey,
      verifyOptions: { issuer, audience: `${issuer}${resourcePath}` },
    })) as AccessTokenClaims;
  } catch {
    // A bad signature, a wrong audience, an expired token and something that
    // was never a JWT are all one answer: this bearer is nobody.
    return anonymous;
  }
  // A sender-constrained token (RFC 9449) is only valid with its proof, which
  // this path cannot check. Accepting it as a plain bearer would undo the
  // constraint, so it is refused instead.
  if (claims.cnf) return anonymous;

  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const clientId =
    typeof claims.client_id === "string"
      ? claims.client_id
      : typeof claims.azp === "string"
        ? claims.azp
        : null;
  if (!userId || !clientId) return anonymous;
  const context = await auth.$context;
  const user = await context.internalAdapter.findUserById(userId);
  if (!user) return anonymous;

  const issuedAt = typeof claims.iat === "number" ? claims.iat * 1000 : Date.now();
  const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : Date.now();
  const id = typeof claims.jti === "string" ? claims.jti : token.slice(-32);
  return {
    principal: { kind: "oauth", clientId, scopes: scopesOf(claims.scope) },
    session: {
      user,
      session: {
        // Not a session row, the way an API key's is not: the token is its own
        // record, and its id rather than the token itself rides in the context.
        id,
        userId: user.id,
        token: id,
        createdAt: new Date(issuedAt),
        updatedAt: new Date(issuedAt),
        expiresAt: new Date(expiresAt),
      },
    } as Session,
  };
}

/** The granted scopes, which ride on the principal and are enforced by nothing in v1. */
function scopesOf(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

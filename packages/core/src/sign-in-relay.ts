import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/**
 * Signing in through a relay (ADR-0030, docs/plans/hosted.md).
 *
 * A provider's OAuth App holds one callback URL, or a short list it matches
 * exactly, and a platform with many deevys — hosted Workspaces at
 * `app.deevy.dev/<slug>`, or an operator's several deployments — cannot
 * register a callback for each, nor ask every team to register an App of its
 * own to sign in. So one URL, the relay's, is registered for all of them, and
 * the relay sends each callback back to the deevy that started it.
 *
 * The relay does nothing else. It never exchanges a code and never sees a
 * token: the deevy that started the sign-in exchanges the code itself, naming
 * the relay's callback as its `redirect_uri` exactly as the authorization
 * request did, and Better Auth's own checks — the state it stored and the
 * cookie it set in this browser — decide whether the code is this browser's.
 * A code sent to the wrong deevy finds no state there and signs nobody in.
 *
 * What the relay needs to know is where to send the browser, and that rides in
 * the `state` parameter the provider hands back unchanged: the deevy's own
 * state, wrapped with where it lives and signed with a secret the relay and
 * every deevy behind it share, so a callback cannot be pointed anywhere else.
 */

/** Where a relayed callback lands, and what is signed to say so. */
interface Envelope {
  /** The Better Auth base URL of the deevy that started the sign-in: `…/acme/api/auth`. */
  to: string;
  /** That deevy's own state, which it checks against its database and cookie. */
  state: string;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`deevy:sign-in-relay:v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

/** A deevy's state, wrapped with where its callback lands and signed for the relay. */
export async function wrapRelayState(envelope: Envelope, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify({ t: envelope.to, s: envelope.state })));
  return `${body}.${base64url(await hmac(secret, body))}`;
}

/** The envelope a relayed state carries, or null when it was not signed with this secret. */
export async function unwrapRelayState(wrapped: string, secret: string): Promise<Envelope | null> {
  const [body, signature, ...rest] = wrapped.split(".");
  if (!body || !signature || rest.length > 0) return null;
  const given = fromBase64url(signature);
  if (!given || !sameBytes(given, await hmac(secret, body))) return null;
  const bytes = fromBase64url(body);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { t?: unknown; s?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.s !== "string") return null;
    return { to: parsed.t, state: parsed.s };
  } catch {
    return null;
  }
}

/**
 * What a deevy needs to sign in through a relay: the relay's URL, whose
 * `/callback/<provider>` is what every provider's App is registered with, the
 * secret shared with it, and which providers go through it. A provider that
 * is the deevy's own — a Workspace's OpenID Connect IdP, a GitLab instance of
 * its own — is never relayed: its App is registered with the deevy itself.
 */
export interface SignInRelayClient {
  url: string;
  secret: string;
  providers: string[];
  /** This deevy's own Better Auth URL, where a relayed callback lands: `…/acme/api/auth`. */
  own: string;
}

/**
 * The Better Auth plugin a deevy behind a relay runs.
 *
 * Before a sign-in or a link starts, and before its callback is handled, the
 * request's base URL becomes the relay's, which is what Better Auth builds a
 * provider's `redirect_uri` from on both legs — so the authorization request
 * and the code exchange name the same callback, as OAuth requires. After a
 * sign-in or a link starts, the state in the authorization URL is wrapped
 * with where this deevy lives. Everything between is Better Auth's own.
 */
export function signInRelay(relay: SignInRelayClient): BetterAuthPlugin {
  const relayed = new Set(relay.providers);
  const relayBase = relay.url.replace(/\/+$/, "");
  const starting = (path: string | undefined) =>
    path === "/sign-in/social" || path === "/link-social";
  const providerOf = (context: { path?: string | undefined; body?: unknown; params?: unknown }) => {
    if (starting(context.path)) {
      const provider = (context.body as { provider?: unknown } | undefined)?.provider;
      return typeof provider === "string" ? provider : null;
    }
    if (context.path === "/callback/:id") {
      const id = (context.params as { id?: unknown } | undefined)?.id;
      return typeof id === "string" ? id : null;
    }
    return null;
  };
  return {
    id: "deevy-sign-in-relay",
    hooks: {
      before: [
        {
          matcher: (context) => {
            const provider = providerOf(context);
            return provider !== null && relayed.has(provider);
          },
          handler: createAuthMiddleware(async (ctx) => {
            ctx.context.baseURL = relayBase;
          }),
        },
      ],
      after: [
        {
          matcher: (context) => {
            if (!starting(context.path)) return false;
            const provider = providerOf(context);
            return provider !== null && relayed.has(provider);
          },
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as { url?: unknown } | undefined;
            if (!returned || typeof returned !== "object" || typeof returned.url !== "string")
              return;
            const authorization = new URL(returned.url);
            const state = authorization.searchParams.get("state");
            if (!state) return;
            authorization.searchParams.set(
              "state",
              // Where the callback lands: this deevy's own Better Auth URL,
              // not the relay's the request now carries.
              await wrapRelayState({ to: relay.own.replace(/\/+$/, ""), state }, relay.secret),
            );
            ctx.context.returned = { ...returned, url: authorization.toString() };
          }),
        },
      ],
    },
  };
}

/** What a relay needs: the shared secret, and which deevys it may send a browser back to. */
export interface SignInRelayServer {
  secret: string;
  /**
   * Whether a callback may land at this Better Auth URL. A relay sends a
   * browser carrying an authorization code, so it sends one only where it was
   * told a deevy lives — never wherever a state, however well signed, says.
   */
  allows(target: string): boolean | Promise<boolean>;
}

/** The relay's answer when it cannot tell where the sign-in came from. */
function nowhere(): Response {
  return new Response(
    "<!doctype html><title>Sign-in didn't finish</title><p>This sign-in can't be finished from here. Go back to deevy and start it again.</p>",
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * The relay: `…/callback/<provider>` sends the browser, with everything the
 * provider sent, to the deevy whose state it carries, with that deevy's own
 * state put back. `path` is what follows the relay's base URL.
 */
export async function relaySignInCallback(
  request: Request,
  path: string,
  relay: SignInRelayServer,
): Promise<Response> {
  const match = /^\/callback\/([a-z0-9-]+)$/.exec(path);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) return nowhere();
  const url = new URL(request.url);
  const envelope = await unwrapRelayState(url.searchParams.get("state") ?? "", relay.secret);
  if (!envelope) return nowhere();
  let target: URL;
  try {
    target = new URL(`${envelope.to}/callback/${match[1]}`);
  } catch {
    return nowhere();
  }
  if (
    target.protocol !== "https:" &&
    target.hostname !== "localhost" &&
    target.hostname !== "127.0.0.1"
  )
    return nowhere();
  if (!(await relay.allows(envelope.to))) return nowhere();
  for (const [name, value] of url.searchParams) {
    target.searchParams.set(name, name === "state" ? envelope.state : value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

/** The variables a deployment names its relay with, on either runtime. */
export interface SignInRelayVariables {
  DEEVY_SIGN_IN_RELAY_URL?: string | undefined;
  DEEVY_SIGN_IN_RELAY_SECRET?: string | undefined;
  DEEVY_SIGN_IN_RELAY_ALLOW?: string | undefined;
}

/**
 * Both halves, from the environment. A deevy behind a relay names its URL and
 * the shared secret; a deevy that is a relay names the secret and the URLs it
 * may send a browser back to, as a comma-separated list of prefixes. One
 * deployment may be either, both, or neither; without the secret it is neither.
 */
export function signInRelayFromEnv(variables: SignInRelayVariables): {
  client: { url: string; secret: string } | null;
  server: SignInRelayServer | null;
} {
  const secret = variables.DEEVY_SIGN_IN_RELAY_SECRET?.trim() ?? "";
  if (!secret) return { client: null, server: null };
  const url = variables.DEEVY_SIGN_IN_RELAY_URL?.trim().replace(/\/+$/, "") ?? "";
  const prefixes = (variables.DEEVY_SIGN_IN_RELAY_ALLOW ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter((prefix) => /^https?:\/\/[^/]+\//.test(prefix));
  return {
    client: url ? { url, secret } : null,
    server:
      prefixes.length > 0
        ? { secret, allows: (target) => prefixes.some((prefix) => target.startsWith(prefix)) }
        : null,
  };
}

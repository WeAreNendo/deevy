/**
 * Signing in from a terminal: OAuth 2.1 authorization code with PKCE, and a
 * loopback listener for the redirect (RFC 8252).
 *
 * The CLI is a public client — there is nowhere on a laptop to keep a secret
 * that the person at the laptop cannot read — so PKCE is what stands in for
 * one, and the authorization server requires S256 of every code flow anyway.
 *
 * It registers itself by Dynamic Client Registration rather than by a Client ID
 * Metadata Document, and that is forced rather than chosen: deevy links the API
 * resource to a client only if the client names it at registration, and a CIMD
 * client has no way to name one — it would be linked to MCP alone and every
 * call would then be refused (ADR-0023).
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { API_PATH } from "@deevy/core";
import type { StoredToken } from "./credentials.ts";

/** What the authorization server says about itself (RFC 8414). */
interface ServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

/** RFC 7636 S256. The verifier is the secret; the challenge is what travels. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export async function discover(origin: string, fetchImpl = fetch): Promise<ServerMetadata> {
  const res = await fetchImpl(`${origin}/.well-known/oauth-authorization-server`);
  if (!res.ok) {
    throw new Error(
      `${origin} does not look like a deevy with sign-in configured ` +
        `(its authorization server metadata answered ${String(res.status)}). ` +
        `An instance without BETTER_AUTH_URL set has no OAuth server at all.`,
    );
  }
  return (await res.json()) as ServerMetadata;
}

/**
 * A client of this instance, registered for the API resource.
 *
 * Every sign-in registers a new one, which leaves a row in the Human's consent
 * list each time. Reusing one would want its client id kept beside the token —
 * and a redirect URI to match, which a loopback client does not have, because
 * RFC 8252 has it take whatever port the OS gives. Revoking the old ones is
 * `oauthClients.revoke`, which wants a cookie session and so is deevy's own UI
 * rather than this (ADR-0023).
 */
export async function register(
  metadata: ServerMetadata,
  origin: string,
  redirectUri: string,
  fetchImpl = fetch,
): Promise<string> {
  const endpoint = metadata.registration_endpoint ?? `${origin}/api/auth/oauth2/register`;
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "deevy CLI",
      redirect_uris: [redirectUri],
      // No refresh_token: nothing here refreshes, and a refresh token at rest
      // is a larger thing to lose for a benefit nobody is taking yet. An
      // expired token is answered by signing in again.
      grant_types: ["authorization_code"],
      response_types: ["code"],
      // A public client: no secret to present, PKCE instead.
      token_endpoint_auth_method: "none",
      application_type: "native",
      // The half that matters. Without it deevy links this client to the MCP
      // resource alone and every operation call is refused (ADR-0023).
      resources: [`${origin}${API_PATH}`],
    }),
  });
  if (res.status !== 201) {
    throw new Error(`registering with ${origin} failed: ${String(res.status)} ${await res.text()}`);
  }
  return ((await res.json()) as { client_id: string }).client_id;
}

/**
 * A listener on 127.0.0.1 for the one redirect, and the code it carries.
 *
 * The port is whatever the OS gives, which RFC 8252 allows a native client to
 * do and which is why the redirect is registered per sign-in rather than once.
 */
export interface Loopback {
  redirectUri: string;
  /** Resolves with the authorization code, or rejects with what came back instead. */
  code: Promise<string>;
  close: () => void;
}

/** Long enough to find the browser window, short enough not to be a hang. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export function listen(state: string, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<Loopback> {
  return new Promise((resolveListening, rejectListening) => {
    let settle: (code: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const code = new Promise<string>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // The redirect can fail before anybody awaits this — somebody declines the
    // consent while the CLI is still setting up — and an unobserved rejection
    // is a warning printed over the message that explains what happened. One
    // observer here keeps it quiet; a real awaiter still sees the rejection.
    code.catch(() => {});
    // Nobody ever arrives if the browser never opened, or was closed on the
    // consent screen. Without this the CLI waits for a redirect that is not
    // coming, with no output and no exit.
    const expiry = setTimeout(() => {
      fail(new Error("the sign-in was not completed in time. Run `deevy login` again."));
    }, timeoutMs);
    expiry.unref();

    const server: Server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const answer = (status: number, text: string) => {
        response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
        response.end(text);
      };
      // A browser asks for /favicon.ico the moment it renders anything.
      if (url.pathname !== "/callback") return answer(404, "not here");
      // The state is the CSRF guard: a callback that does not carry the one
      // this run generated is not this run's callback — so it is answered and
      // ignored, and the listener keeps waiting for the real one. Failing here
      // instead would let anything that probes 127.0.0.1 end somebody's sign-in
      // before they reached the consent screen, which is the opposite of what
      // the guard is for.
      if (url.searchParams.get("state") !== state) {
        return answer(400, "That sign-in did not come from this terminal.");
      }
      const error = url.searchParams.get("error");
      if (error) {
        answer(400, `deevy refused the sign-in: ${error}`);
        return fail(
          new Error(`${error}: ${url.searchParams.get("error_description") ?? ""}`.trim()),
        );
      }
      const received = url.searchParams.get("code");
      if (!received) {
        answer(400, "No code came back.");
        return fail(new Error("the redirect carried no authorization code"));
      }
      answer(200, "Signed in. You can close this tab and go back to your terminal.");
      settle(received);
    });

    server.on("error", rejectListening);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        return rejectListening(new Error("the loopback listener reported no port"));
      }
      resolveListening({
        redirectUri: `http://127.0.0.1:${String(address.port)}/callback`,
        code,
        close: () => {
          clearTimeout(expiry);
          // `close` only stops new connections; a browser's keep-alive socket
          // would hold the process open for Node's five-minute request timeout
          // after the CLI has already said it was done.
          server.closeAllConnections();
          server.close();
        },
      });
    });
  });
}

export function authorizeUrl(
  metadata: ServerMetadata,
  params: {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string;
    resource: string;
  },
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("scope", "openid profile");
  // RFC 8707: which of this server's resources the token is for.
  url.searchParams.set("resource", params.resource);
  return url.toString();
}

export async function exchange(
  metadata: ServerMetadata,
  params: {
    code: string;
    clientId: string;
    verifier: string;
    redirectUri: string;
    resource: string;
  },
  fetchImpl = fetch,
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    code_verifier: params.verifier,
    redirect_uri: params.redirectUri,
    resource: params.resource,
  });
  const res = await fetchImpl(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok)
    throw new Error(`the token exchange failed: ${String(res.status)} ${await res.text()}`);
  const payload = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
    resource: params.resource,
  };
}

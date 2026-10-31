import type {
  Container,
  ExternalRef,
  IdentityScope,
  InboundCheck,
  InboundEvent,
  InboundInput,
  Scope,
  SocketIdentity,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { hmacBase64, sameText } from "../signing.ts";
import { normalizeGitlab } from "./payloads.ts";

/**
 * GitLab, as a tracker deevy listens to and comments on (ADR-0024).
 *
 * One GitLab user is one Socket — a dedicated account, or the bot a project or
 * group access token makes — and deevy acts as it through the token the
 * operator pasted: what it says on an issue, it says as that user. Its code
 * is not deevy's (ADR-0034): an Agent reaches it with access of its own.
 *
 * gitlab.com and a self-managed GitLab are the same module with a different
 * `baseUrl`. Everything here is `fetch` and `crypto.subtle`, for the Worker.
 */

export interface GitlabConfig {
  /** The instance: `https://gitlab.com` unless the Socket names its own. */
  baseUrl?: string;
}

export interface GitlabCredentials {
  /** A personal, project or group access token with the `api` scope. */
  token?: string;
}

export interface GitlabOptions {
  /**
   * The GitLab this deployment signs people in with (`GITLAB_ISSUER`, gitlab.com
   * unless it names its own). A Socket on that same instance takes its
   * accounts from sign-in, so a Human who signed in with GitLab rules from it
   * with no linking step (ADR-0025).
   */
  signInIssuer?: string;
}

const DEFAULT_BASE = "https://gitlab.com";

/** Standard Webhooks' window for a signed timestamp, which GitLab's signing token follows. */
const SIGNED_WINDOW_MS = 5 * 60_000;

/** The project a scope names: its id, which a rename or a move leaves alone. */
function projectOf(scope: Scope): string {
  const id = typeof scope.scopeKey === "string" ? scope.scopeKey : "";
  if (!id) throw new Error("That scope names no GitLab project");
  return id;
}

/**
 * An issue's number inside its project, out of its URL.
 *
 * deevy keeps GitLab's global id, which survives a move, and the REST call
 * that comments on an issue wants the project's own number — which is in the
 * URL deevy already keeps.
 */
function iidOf(ref: ExternalRef): string {
  const match = /\/-\/(?:issues|work_items)\/(\d+)/.exec(ref.url);
  if (!match?.[1]) throw new Error(`That is not a GitLab issue URL: ${ref.url}`);
  return match[1];
}

/**
 * What GitLab said, as words. It refuses in three shapes — a `message` that is
 * a sentence ("401 Unauthorized"), a `message` that is fields and what is
 * wrong with each, and OAuth's `error` with a description and the scope it
 * wanted — and an admin reading why connecting failed should get the words,
 * not the JSON. Null where it said nothing deevy recognises.
 */
export function gitlabSaid(detail: string): string | null {
  let said: unknown;
  try {
    said = JSON.parse(detail);
  } catch {
    return null;
  }
  const found = said && typeof said === "object" ? (said as Record<string, unknown>) : {};
  if (typeof found.error === "string") {
    const description = typeof found.error_description === "string" ? found.error_description : "";
    const needs = typeof found.scope === "string" ? `, needs ${found.scope}` : "";
    return description ? `${description} (${found.error}${needs})` : `${found.error}${needs}`;
  }
  if (typeof found.message === "string") return found.message;
  if (found.message && typeof found.message === "object") {
    return Object.entries(found.message as Record<string, unknown>)
      .map(
        ([field, wrong]) => `${field}: ${Array.isArray(wrong) ? wrong.join(", ") : String(wrong)}`,
      )
      .join("; ");
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Where a GitLab Socket's accounts live: its host, and — when that is the
 * instance deevy signs people in with — the sign-in provider's accounts too.
 */
export function gitlabIdentityScope(baseUrl: string, signInIssuer = DEFAULT_BASE): IdentityScope {
  const instance = hostOf(baseUrl);
  return instance === hostOf(signInIssuer) ? { instance, signInProvider: "gitlab" } : { instance };
}

/**
 * Whether a Standard Webhooks signature — GitLab's signing token — is over
 * these bytes, with the key deevy holds, and recent.
 */
async function signedWith(
  headers: Headers,
  rawBody: string,
  webhookSecret: string,
  now: Date,
): Promise<boolean> {
  const signatures = headers.get("webhook-signature");
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  if (!signatures || !id || !timestamp || !webhookSecret.startsWith("whsec_")) return false;
  const sent = Number(timestamp) * 1000;
  if (!Number.isFinite(sent) || Math.abs(now.getTime() - sent) > SIGNED_WINDOW_MS) return false;

  let key: Uint8Array<ArrayBuffer>;
  try {
    key = Uint8Array.from(atob(webhookSecret.slice("whsec_".length)), (char) => char.charCodeAt(0));
  } catch {
    return false;
  }
  const expected = await hmacBase64(key, `${id}.${timestamp}.${rawBody}`);
  // Several, space-separated, while a token is being rotated.
  return signatures
    .split(" ")
    .some((one) => one.startsWith("v1,") && sameText(one.slice("v1,".length), expected));
}

export function createGitlabSocket(
  { config, credentials, fetch, now }: SocketModuleInput,
  options: GitlabOptions = {},
): SocketModule {
  const settings = config as GitlabConfig;
  const secrets = credentials as GitlabCredentials;
  const base = (settings.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const api = `${base}/api/v4`;

  function token(): string {
    if (!secrets.token) throw new Error("This GitLab Socket has no token; connect it again.");
    return secrets.token;
  }

  async function call<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token()}`,
        "user-agent": "deevy",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      const where = `${method} ${path.split("?")[0] ?? path}`;
      const said = gitlabSaid(detail);
      throw new Error(
        said
          ? `${said} (${where})`
          : `GitLab answered ${String(response.status)} for ${where}: ${detail}`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    provider: "gitlab",
    capabilities: new Set(["tracker"] as const),
    // A webhook's secret token is typed into GitLab, so deevy may mint it; its
    // signing token is GitLab's, pasted back.
    webhookSecretFrom: "either",
    identityScope: gitlabIdentityScope(base, options.signInIssuer),

    /**
     * The user the token belongs to, which is who every comment is by — and
     * a refusal for a token that cannot write. `/user` answers any token at
     * all, so a `read_user` one connected and then failed at every comment;
     * GitLab says what an access token may do at `/personal_access_tokens/self`,
     * and where it cannot say — an OAuth token, or an older GitLab — `/user`
     * stays the proof.
     */
    async identity(): Promise<SocketIdentity> {
      const user = await call<{ id: number; username: string }>("GET", "/user");
      const own = await call<{ scopes?: unknown }>("GET", "/personal_access_tokens/self").catch(
        () => null,
      );
      const scopes = Array.isArray(own?.scopes)
        ? own.scopes.filter((one): one is string => typeof one === "string")
        : null;
      if (scopes && !scopes.includes("api")) {
        throw new Error(
          `This token has ${scopes.join(", ") || "no scopes"}; deevy needs the api scope to comment on issues`,
        );
      }
      return { login: user.username, id: String(user.id), mentionHandle: `@${user.username}` };
    },

    tracker: {
      /**
       * A secret token, compared in constant time, or a signing token's
       * signature over the id, the timestamp and the body. Either proves the
       * sender holds the one secret deevy holds for this Socket.
       */
      async verifyInbound({
        headers,
        rawBody,
        webhookSecret,
        now: at,
      }: InboundInput): Promise<InboundCheck> {
        const eventName = headers.get("x-gitlab-event") ?? "";
        // The key GitLab keeps across its own retries; the event's UUID where
        // an older GitLab sends nothing else.
        const deliveryId =
          headers.get("idempotency-key") ??
          headers.get("webhook-id") ??
          headers.get("x-gitlab-event-uuid");
        const sentToken = headers.get("x-gitlab-token");
        const ok =
          (sentToken !== null && sameText(sentToken, webhookSecret)) ||
          (await signedWith(headers, rawBody, webhookSecret, at ?? now()));
        return { ok, deliveryId, eventName };
      },

      normalize(eventName: string, payload: unknown): InboundEvent[] {
        return normalizeGitlab(eventName, payload);
      },

      async createComment(scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef> {
        const created = await call<{ id: number }>(
          "POST",
          `/projects/${projectOf(scope)}/issues/${iidOf(ref)}/notes`,
          { body },
        );
        const id = String(created.id);
        return { externalId: id, url: `${ref.url}#note_${id}` };
      },

      /** The projects its user can work issues in: Reporter or more, as the setup asks. */
      async listContainers(): Promise<Container[]> {
        const rows = await call<Array<{ id: number; path_with_namespace: string }>>(
          "GET",
          "/projects?membership=true&min_access_level=20&simple=true&per_page=100&order_by=path&sort=asc",
        );
        return rows.map((row) => ({
          scope: { scopeKey: String(row.id), path: row.path_with_namespace },
          scopeKey: String(row.id),
          name: row.path_with_namespace,
        }));
      },
    },
  };
}

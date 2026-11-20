import type {
  Container,
  SetupInput,
  SetupResult,
  ExternalComment,
  ExternalIssue,
  ExternalRef,
  InboundCheck,
  InboundEvent,
  InboundInput,
  IdentityScope,
  IssueDraft,
  IssuePage,
  IssueQuery,
  Scope,
  SocketIdentity,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { credentialTag, hmacHex, sameText } from "../signing.ts";
import { appJwt, importAppKey } from "./keys.ts";
import { commentOf, isPullRequest, issueOf, normalizeGithub } from "./payloads.ts";

/**
 * GitHub Issues, as a tracker deevy projects from (ADR-0024).
 *
 * One GitHub App is one Socket: it has one webhook URL, one identity — the
 * `deevy[bot]` account every comment is authored by — and a list of
 * installations, one per organisation or account that added it. A repository
 * inside one of those installations is a container, and a Project is bound to
 * one of them.
 *
 * Everything here is `fetch` and `crypto.subtle`: this package is bundled into
 * the Cloudflare Worker as well as the image, so there is no `node:` anything
 * and no SDK carrying one.
 */

export interface GithubConfig {
  /** The App's numeric id, which is what its JWT says it is. */
  appId: string;
  /** The App's slug, which is what its bot account is called: `<slug>[bot]`. */
  slug?: string;
  /** The App's own page on GitHub, as GitHub gave it: where it is installed on more. */
  htmlUrl?: string;
  /** GitHub's REST root. GitHub Enterprise Server and the acceptance stub set it. */
  apiBase?: string;
  /** Where the App has been installed, learned at connect and from deliveries. */
  installations?: { id: string; account: string }[];
}

export interface GithubCredentials {
  /** The `.pem` GitHub gave the operator, PKCS#1 or PKCS#8 (keys.ts). */
  privateKey?: string;
  /** For the sign-in and identity flows that come later; unread here. */
  clientId?: string;
  clientSecret?: string;
}

const DEFAULT_API = "https://api.github.com";

/** How long a minted installation token is trusted for, less a minute of slack. */
const TOKEN_SLACK_MS = 60_000;

/** GitHub's largest page, and how a short one says it was the last. */
const PAGE_SIZE = 100;

/**
 * The most pages one list is read to: ten thousand of anything. A server that
 * ignores `page` answers the first one again and again, and a list read to a
 * short page would then never end.
 */
const MAX_PAGES = 100;

interface Minted {
  token: string;
  expiresAt: number;
}

/**
 * What GitHub answered when it did not say yes, with the status kept, so a
 * caller can tell an installation that is gone from a GitHub that is busy.
 */
class GithubError extends Error {
  readonly status: number;
  /** A 429, or a 403 that says it is a rate limit: "later", never "no". */
  readonly rateLimited: boolean;

  constructor(message: string, status: number, rateLimited: boolean) {
    super(message);
    this.name = "GithubError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

/**
 * Whether GitHub said no to this installation for good: it is gone (404), or
 * will not let the App in (401, or a 403 that is not a rate limit). Anything
 * else — a rate limit, a 5xx, a network that failed — is GitHub not answering,
 * which says nothing about the installation.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof GithubError &&
    !error.rateLimited &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

/**
 * Installation tokens, shared across requests in one isolate.
 *
 * A module is built per request, so a cache inside it would mint a token for
 * every call. GitHub's tokens live an hour, and minting one costs a round trip
 * and a signature — this is the difference between one request per delivery
 * and three.
 *
 * Both maps are filed under the API, the App's id and a tag of its private
 * key. The cache is read before the key ever signs anything, and an App id is
 * public, so one keyed by the id alone would hand a Socket connected with
 * somebody else's App id and any key the tokens that App's real owner minted —
 * across Workspaces, once one isolate serves several. The API is in it because
 * two GitHub Enterprise Servers number their Apps independently.
 *
 * These are deevy's own, and reach every repository of their installation.
 */
const tokens = new Map<string, Minted>();

/** Which installation covers a repository. Answered once, then remembered. */
const installations = new Map<string, string>();

/** `acme/deevy` out of a scope, which is how a Project names a repository. */
function repositoryOf(scope: Scope): { owner: string; repo: string; scopeKey: string } {
  const scopeKey = typeof scope.scopeKey === "string" ? scope.scopeKey : "";
  const [owner = "", repo = ""] = scopeKey.split("/");
  if (!owner || !repo) {
    throw new Error(`That scope names no GitHub repository: ${scopeKey || "(nothing)"}`);
  }
  return { owner, repo, scopeKey };
}

/**
 * The issue number out of a record's URL.
 *
 * deevy stores GitHub's node id, which survives a transfer, and every REST
 * call wants the number — which is in the URL deevy already keeps, and is the
 * one thing about a record that is true in both places.
 */
function numberFrom(ref: ExternalRef): string {
  const match = /\/issues\/(\d+)/.exec(ref.url);
  if (!match?.[1]) throw new Error(`That is not a GitHub issue URL: ${ref.url}`);
  return match[1];
}

/**
 * Where a GitHub Socket's accounts live: the host its API is on.
 *
 * `api.github.com` is github.com, and github.com's accounts are the ones deevy
 * signs people in with — Better Auth's GitHub provider knows no other host — so
 * a Human who signed in with GitHub rules from github.com with no linking step.
 * A GitHub Enterprise Server is a different set of accounts with the same ids
 * in it, and shares nothing (ADR-0025).
 */
export function githubIdentityScope(api: string): IdentityScope {
  const host = new URL(api).hostname;
  const instance = host === "api.github.com" ? "github.com" : host;
  return instance === "github.com" ? { instance, signInProvider: "github" } : { instance };
}

/**
 * GitHub's REST root: a Socket's own, or github.com's. A Socket's
 * configuration can come from whoever called the API (`sockets.begin`), so
 * one that is not an http(s) address is refused in words here, where the
 * module is built, rather than failing later as a TypeError.
 */
function apiRoot(apiBase: unknown): string {
  if (apiBase === undefined) return DEFAULT_API;
  let url: URL | null = null;
  try {
    url = typeof apiBase === "string" ? new URL(apiBase) : null;
  } catch {
    url = null;
  }
  if (typeof apiBase !== "string" || !url || !["https:", "http:"].includes(url.protocol)) {
    const said = typeof apiBase === "string" ? apiBase.slice(0, 200) : typeof apiBase;
    throw new Error(`That is not the address of a GitHub API: ${said}`);
  }
  return apiBase.replace(/\/+$/, "");
}

export function createGithubSocket({
  config,
  credentials,
  fetch,
  now,
}: SocketModuleInput): SocketModule {
  const settings = config as unknown as GithubConfig;
  const api = apiRoot(settings.apiBase);
  const secrets = credentials as unknown as GithubCredentials;
  let key: Promise<CryptoKey> | null = null;
  let filed: Promise<string> | null = null;

  function privateKey(): string {
    if (!secrets.privateKey) {
      throw new Error("This GitHub Socket has no private key; connect the App again.");
    }
    return secrets.privateKey;
  }

  /** The App's own credential, imported once per module. */
  function appKey(): Promise<CryptoKey> {
    key ??= importAppKey(privateKey());
    return key;
  }

  /** What this App's tokens and installations are cached under: see `tokens`. */
  function cachePrefix(): Promise<string> {
    filed ??= (async () => `${api}:${settings.appId}:${await credentialTag(privateKey())}`)();
    return filed;
  }

  async function call<T>(path: string, init: RequestInit & { token: string }): Promise<T> {
    const { token, ...rest } = init;
    const response = await fetch(`${api}${path}`, {
      ...rest,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "deevy",
        // The manifest conversion is the one call with no credential at all:
        // the one-use code in the path is what authenticates it.
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.body === undefined ? {} : { "content-type": "application/json" }),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      // GitHub's primary limit is a 403 with no requests left, its secondary
      // one a 403 or a 429 with a Retry-After, and both say so in words.
      const rateLimited =
        response.status === 429 ||
        response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after") ||
        /rate limit/i.test(detail);
      throw new GithubError(
        `GitHub answered ${String(response.status)} for ${path}: ${detail}`,
        response.status,
        rateLimited,
      );
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  /** As the App itself: what `/app` and the token endpoints take. */
  async function asApp<T>(path: string, init: RequestInit = {}): Promise<T> {
    return call<T>(path, { ...init, token: await appJwt(await appKey(), settings.appId, now()) });
  }

  /** As an installation: what every repository call takes. */
  async function asInstallation<T>(
    scopeKey: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    return call<T>(path, { ...init, token: await installationToken(scopeKey) });
  }

  async function installationIdFor(scopeKey: string): Promise<string> {
    const cacheKey = `${await cachePrefix()}:${scopeKey}`;
    const known = installations.get(cacheKey);
    if (known) return known;
    const { owner, repo } = repositoryOf({ scopeKey });
    const found = await asApp<{ id: number }>(`/repos/${owner}/${repo}/installation`);
    const id = String(found.id);
    installations.set(cacheKey, id);
    return id;
  }

  /** A new token from GitHub for an installation, as far as the installation reaches. */
  async function mint(id: string): Promise<Minted> {
    const minted = await asApp<{ token: string; expires_at: string }>(
      `/app/installations/${id}/access_tokens`,
      { method: "POST" },
    );
    return { token: minted.token, expiresAt: new Date(minted.expires_at).getTime() };
  }

  /** A token for an installation deevy already knows the id of. */
  async function mintedFor(id: string): Promise<Minted> {
    const cacheKey = `${await cachePrefix()}:${id}`;
    const held = tokens.get(cacheKey);
    if (held && held.expiresAt - TOKEN_SLACK_MS > now().getTime()) return held;
    const fresh = await mint(id);
    tokens.set(cacheKey, fresh);
    return fresh;
  }

  async function tokenForInstallation(id: string): Promise<string> {
    return (await mintedFor(id)).token;
  }

  /**
   * A token for the installation that covers a repository: deevy's own, from
   * `tokens`.
   *
   * An id remembered from before the App was uninstalled there and installed
   * again is a dead one, and GitHub says so by answering 404 for its token.
   * deevy then forgets it, and any token minted for it, and asks once which
   * installation covers the repository now. Forgetting it when the removal is
   * delivered would not be enough: that delivery may reach another isolate.
   */
  async function mintedForRepository(scopeKey: string): Promise<Minted> {
    const prefix = await cachePrefix();
    const remembered = installations.has(`${prefix}:${scopeKey}`);
    const id = await installationIdFor(scopeKey);
    try {
      return await mintedFor(id);
    } catch (error) {
      if (!remembered || !(error instanceof GithubError) || error.status !== 404) throw error;
      tokens.delete(`${prefix}:${id}`);
      for (const [key, value] of installations) {
        if (value === id && key.startsWith(`${prefix}:`)) installations.delete(key);
      }
      return mintedFor(await installationIdFor(scopeKey));
    }
  }

  async function installationToken(scopeKey: string): Promise<string> {
    return (await mintedForRepository(scopeKey)).token;
  }

  /**
   * Where GitHub says the App is installed, every page of it, each one written
   * as the install's redirect writes it. Less any GitHub has suspended: it
   * mints no token for one, and that refusal would leave every other
   * installation's repositories unlisted.
   */
  async function installedOn(): Promise<{ id: string; account: string }[]> {
    const found: { id: string; account: string }[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const rows = await asApp<
        { id: number; account?: { login?: string } | null; suspended_at?: string | null }[]
      >(`/app/installations?per_page=${String(PAGE_SIZE)}&page=${String(page)}`);
      for (const row of rows) {
        if (row.suspended_at) continue;
        found.push({ id: String(row.id), account: row.account?.login ?? "" });
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return found;
  }

  /**
   * Where the App is installed, for listing what it can see: GitHub's answer
   * every time. What the Socket keeps is written one redirect or delivery at
   * a time, and one that names one account says nothing of another the Socket
   * never heard of. What it keeps is the answer only when GitHub cannot be
   * asked, and keeping nothing is then no answer at all.
   */
  async function whereInstalled(): Promise<{ id: string; account: string }[]> {
    try {
      return await installedOn();
    } catch (error) {
      const kept = settings.installations ?? [];
      if (kept.length === 0) throw error;
      return kept;
    }
  }

  const identityScope = githubIdentityScope(api);

  return {
    provider: "github",
    capabilities: new Set(["tracker"] as const),
    // The manifest conversion hands GitHub's own back, and the App's settings
    // take any typed in, so deevy may mint one too.
    webhookSecretFrom: "either",
    identityScope,
    // The manifest is a form the browser posts from deevy's page, whose policy
    // lets a form go only to github.com (packages/core/src/headers.ts): posted
    // to any other GitHub — a GitHub Enterprise Server, or GHE.com — it is
    // refused before it leaves. Said to whoever reads it on a screen, so in
    // the screen's words.
    ...(identityScope.instance === "github.com"
      ? {}
      : {
          beginRefusal:
            "deevy can make a GitHub App for you only on github.com, and this GitHub is a GitHub Enterprise Server or GHE.com. Make the App there, under Developer settings › GitHub Apps, and connect it with Paste an App you already have.",
        }),

    /**
     * Who deevy is on GitHub: the App's own bot account. The loop guard reads
     * this to drop the comments deevy itself wrote (ADR-0025).
     *
     * And what a pasted App never said, which the manifest's conversion would
     * have. Its slug, and its page, which is where it is installed on more and
     * is a GitHub Enterprise Server's own there. And where it is installed, as
     * GitHub says it: an App pasted after it was installed missed both the
     * install's redirect and the `installation` delivery, and would offer no
     * repository until an installation changed. GitHub's list replaces the one
     * kept, so asking again (`sockets.test`) also lets go of an installation
     * that is gone.
     */
    async identity(): Promise<SocketIdentity> {
      const app = await asApp<{ id: number; slug: string; name: string; html_url?: string }>(
        "/app",
      );
      return {
        login: `${app.slug}[bot]`,
        id: String(app.id),
        mentionHandle: `@${app.slug}`,
        learned: {
          slug: app.slug,
          ...(app.html_url ? { htmlUrl: app.html_url } : {}),
          installations: await installedOn(),
        },
      };
    },

    /**
     * The two redirects that finish connecting a GitHub App (ADR-0024).
     *
     * `code` is the manifest conversion: the operator made the App from the
     * manifest deevy wrote, and GitHub will trade this one-use code for the
     * App's own id, key and webhook secret exactly once. `installation_id` is
     * the redirect after they installed it somewhere — and deevy asks GitHub
     * what that id is rather than believing the query string, because whoever
     * is standing at the URL could have typed any number.
     */
    async setup({ params }: SetupInput): Promise<SetupResult> {
      if (params.code) {
        const converted = await call<{
          id: number;
          slug: string;
          name: string;
          pem: string;
          webhook_secret: string;
          client_id: string;
          client_secret: string;
          html_url?: string;
        }>(`/app-manifests/${encodeURIComponent(params.code)}/conversions`, {
          method: "POST",
          // The conversion is the one GitHub call that authenticates nothing:
          // the code is the credential, and it is spent here.
          token: "",
        });
        return {
          config: {
            appId: String(converted.id),
            slug: converted.slug,
            ...(converted.html_url ? { htmlUrl: converted.html_url } : {}),
          },
          credentials: {
            privateKey: converted.pem,
            clientId: converted.client_id,
            clientSecret: converted.client_secret,
          },
          webhookSecret: converted.webhook_secret,
          identity: {
            login: `${converted.slug}[bot]`,
            id: String(converted.id),
            mentionHandle: `@${converted.slug}`,
          },
          summary: `Connected the GitHub App ${converted.name}`,
          // Straight on to installing it: an App installed nowhere has nothing
          // to work, and the install's own redirect brings the operator back
          // here (`setup_url`). GitHub's own address for the App, so a GitHub
          // Enterprise Server's is right too.
          ...(converted.html_url
            ? { redirectTo: `${converted.html_url.replace(/\/+$/, "")}/installations/new` }
            : {}),
        };
      }

      if (params.installation_id) {
        const installation = await asApp<{
          id: number;
          account?: { login?: string };
          suspended_at?: string | null;
        }>(`/app/installations/${encodeURIComponent(params.installation_id)}`);
        // GitHub's own id, never the query string's spelling of it, so the
        // same installation is never kept twice; and not one GitHub has
        // suspended, which mints no token until it is unsuspended, and whose
        // unsuspension is delivered as an installation.
        const id = String(installation.id);
        const account = installation.account?.login ?? "";
        if (installation.suspended_at) {
          return {
            summary: `The App is installed on ${account || id}, but GitHub has suspended it there`,
          };
        }
        const known = (settings.installations ?? []).filter((one) => one.id !== id);
        return {
          config: { installations: [...known, { id, account }] },
          summary: `The App is installed on ${account}`,
        };
      }

      throw new Error("That redirect carried nothing to finish connecting with.");
    },

    /**
     * The App has one webhook, and GitHub lets the App itself say where it
     * goes: what an instance whose address moved needs, rather than an
     * operator retyping it in the App's settings (docs/OPERATIONS.md).
     */
    async rewire(url: string): Promise<void> {
      await asApp("/app/hook/config", {
        method: "PATCH",
        body: JSON.stringify({ url, content_type: "json" }),
      });
    },

    tracker: {
      async verifyInbound({
        headers,
        rawBody,
        webhookSecret,
      }: InboundInput): Promise<InboundCheck> {
        const eventName = headers.get("x-github-event") ?? "";
        const deliveryId = headers.get("x-github-delivery");
        const signature = headers.get("x-hub-signature-256") ?? "";
        const expected = `sha256=${await hmacHex(webhookSecret, rawBody)}`;
        return { ok: sameText(signature, expected), deliveryId, eventName };
      },

      normalize(eventName: string, payload: unknown): InboundEvent[] {
        return normalizeGithub(eventName, payload);
      },

      async getIssue(scope: Scope, ref: ExternalRef): Promise<ExternalIssue> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const issue = await asInstallation<unknown>(
          scopeKey,
          `/repos/${owner}/${repo}/issues/${numberFrom(ref)}`,
        );
        const read = issueOf(scopeKey, issue);
        if (!read) throw new Error(`GitHub answered with no issue for ${ref.url}`);
        return read;
      },

      async listIssues(scope: Scope, query: IssueQuery): Promise<IssuePage> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        // Oldest change first, so a catch-up walks forward and a page that is
        // full leaves the rest for the next one.
        const page = Number(query.cursor ?? "1");
        const search = new URLSearchParams({
          state: "all",
          sort: "updated",
          direction: "asc",
          per_page: String(query.limit),
          page: String(page),
        });
        if (query.updatedSince) search.set("since", query.updatedSince.toISOString());
        const rows = await asInstallation<unknown[]>(
          scopeKey,
          `/repos/${owner}/${repo}/issues?${search.toString()}`,
        );
        // GitHub lists pull requests among its issues, and a pull request is
        // not a unit of work deevy projects: it is evidence on one.
        const issues = rows
          .filter((row) => !isPullRequest(row))
          .map((row) => issueOf(scopeKey, row))
          .filter((issue): issue is ExternalIssue => issue !== null);
        return {
          issues,
          nextCursor: rows.length >= query.limit ? String(page + 1) : null,
        };
      },

      async listComments(
        scope: Scope,
        ref: ExternalRef,
        limit: number,
      ): Promise<ExternalComment[]> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const rows = await asInstallation<unknown[]>(
          scopeKey,
          `/repos/${owner}/${repo}/issues/${numberFrom(ref)}/comments?per_page=${String(limit)}`,
        );
        return rows
          .map((row) => commentOf(row))
          .filter((comment): comment is ExternalComment => comment !== null);
      },

      async createIssue(
        scope: Scope,
        draft: IssueDraft,
      ): Promise<ExternalIssue & { parentLinked: boolean }> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const created = await asInstallation<{ id: number }>(
          scopeKey,
          `/repos/${owner}/${repo}/issues`,
          {
            method: "POST",
            body: JSON.stringify({
              title: draft.title,
              body: draft.body,
              ...(draft.labels.length > 0 ? { labels: draft.labels } : {}),
            }),
          },
        );
        const issue = issueOf(scopeKey, created);
        if (!issue) throw new Error("GitHub answered with no issue after creating one");

        // The sub-issue call takes the child's numeric id, not its node id,
        // and is the one part of this a GitHub Enterprise Server may not have.
        let parentLinked = false;
        if (draft.parent) {
          try {
            await asInstallation(
              scopeKey,
              `/repos/${owner}/${repo}/issues/${numberFrom(draft.parent)}/sub_issues`,
              { method: "POST", body: JSON.stringify({ sub_issue_id: created.id }) },
            );
            parentLinked = true;
          } catch {
            // deevy keeps the tree itself where the tracker cannot, so a
            // refusal here costs the link on GitHub and nothing else.
            parentLinked = false;
          }
        }
        return { ...issue, parentExternalId: null, parentLinked };
      },

      async createComment(scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const created = await asInstallation<{ node_id: string; html_url: string }>(
          scopeKey,
          `/repos/${owner}/${repo}/issues/${numberFrom(ref)}/comments`,
          { method: "POST", body: JSON.stringify({ body }) },
        );
        return { externalId: created.node_id, url: created.html_url };
      },

      async setLabels(
        scope: Scope,
        ref: ExternalRef,
        change: { add: string[]; remove: string[] },
      ): Promise<void> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const number = numberFrom(ref);
        // Adding a label GitHub has never seen creates it, which is the lazy
        // creation the mirror relies on (docs/plans/sockets.md, slice 7).
        if (change.add.length > 0) {
          await asInstallation(scopeKey, `/repos/${owner}/${repo}/issues/${number}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels: change.add }),
          });
        }
        for (const label of change.remove) {
          try {
            await asInstallation(
              scopeKey,
              `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
              { method: "DELETE" },
            );
          } catch {
            // A label that is not on the issue is not an error: the state deevy
            // wanted is the state there is.
          }
        }
      },

      /**
       * Every repository the App can see, one installation at a time and every
       * page of each: an installation can cover more repositories than GitHub
       * puts on its largest page, and the rest are as bindable as the first.
       *
       * Which installations is GitHub's word rather than the Socket's
       * (`whereInstalled`), so a Socket pasted before `identity` learned them,
       * or one a single delivery has since told of one account of several,
       * still offers everything the App was installed on.
       *
       * One GitHub says is gone or refuses (`isRefusal`) — removed or
       * suspended before deevy heard — costs its own repositories and nobody
       * else's; only when every installation refuses is that the answer, since
       * then it is the App. A GitHub that is rate limiting or down is not a
       * refusal, and is said rather than read as a shorter list.
       */
      async listContainers(): Promise<Container[]> {
        const installations = await whereInstalled();
        const containers: Container[] = [];
        const refused: GithubError[] = [];
        for (const installation of installations) {
          // Kept apart until the last page has answered, so an installation
          // that refuses halfway offers nothing rather than half of itself.
          const found: Container[] = [];
          try {
            const token = await tokenForInstallation(installation.id);
            for (let number = 1; number <= MAX_PAGES; number += 1) {
              const page = await call<{
                repositories: { full_name: string; name: string }[];
              }>(
                `/installation/repositories?per_page=${String(PAGE_SIZE)}&page=${String(number)}`,
                { token },
              );
              for (const repository of page.repositories) {
                found.push({
                  scope: { scopeKey: repository.full_name },
                  scopeKey: repository.full_name,
                  name: repository.full_name,
                });
              }
              if (page.repositories.length < PAGE_SIZE) break;
            }
          } catch (error) {
            if (!isRefusal(error)) throw error;
            refused.push(error as GithubError);
            continue;
          }
          containers.push(...found);
        }
        const [first] = refused;
        if (first && refused.length === installations.length) throw first;
        return containers;
      },
    },
  };
}

/** Forgets every cached token. A test that mints one twice calls it first. */
export function resetGithubTokens(): void {
  tokens.clear();
  installations.clear();
}

import type {
  Container,
  ForgeCredential,
  PullRequestDraft,
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
import { hmacHex, sameText } from "../signing.ts";
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

interface Minted {
  token: string;
  expiresAt: number;
}

/**
 * Installation tokens, shared across requests in one isolate.
 *
 * A module is built per request, so a cache inside it would mint a token for
 * every call. GitHub's tokens live an hour, and minting one costs a round trip
 * and a signature — this is the difference between one request per delivery
 * and three.
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

export function createGithubSocket({
  config,
  credentials,
  fetch,
  now,
}: SocketModuleInput): SocketModule {
  const settings = config as unknown as GithubConfig;
  const api = (settings.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
  const secrets = credentials as unknown as GithubCredentials;
  let key: Promise<CryptoKey> | null = null;

  /** The App's own credential, imported once per module. */
  function appKey(): Promise<CryptoKey> {
    if (!secrets.privateKey) {
      throw new Error("This GitHub Socket has no private key; connect the App again.");
    }
    key ??= importAppKey(secrets.privateKey);
    return key;
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
      throw new Error(`GitHub answered ${String(response.status)} for ${path}: ${detail}`);
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
    const known = installations.get(`${settings.appId}:${scopeKey}`);
    if (known) return known;
    const { owner, repo } = repositoryOf({ scopeKey });
    const found = await asApp<{ id: number }>(`/repos/${owner}/${repo}/installation`);
    const id = String(found.id);
    installations.set(`${settings.appId}:${scopeKey}`, id);
    return id;
  }

  /** A token for an installation deevy already knows the id of. */
  async function mintedFor(id: string): Promise<Minted> {
    const cacheKey = `${settings.appId}:${id}`;
    const held = tokens.get(cacheKey);
    if (held && held.expiresAt - TOKEN_SLACK_MS > now().getTime()) return held;
    const minted = await asApp<{ token: string; expires_at: string }>(
      `/app/installations/${id}/access_tokens`,
      { method: "POST" },
    );
    const fresh = { token: minted.token, expiresAt: new Date(minted.expires_at).getTime() };
    tokens.set(cacheKey, fresh);
    return fresh;
  }

  async function tokenForInstallation(id: string): Promise<string> {
    return (await mintedFor(id)).token;
  }

  async function installationToken(scopeKey: string): Promise<string> {
    return tokenForInstallation(await installationIdFor(scopeKey));
  }

  return {
    provider: "github",
    capabilities: new Set(["tracker", "forge"] as const),
    identityScope: githubIdentityScope(api),

    /**
     * Who deevy is on GitHub: the App's own bot account. The loop guard reads
     * this to drop the comments deevy itself wrote (ADR-0025).
     */
    async identity(): Promise<SocketIdentity> {
      const app = await asApp<{ id: number; slug: string; name: string }>("/app");
      return {
        login: `${app.slug}[bot]`,
        id: String(app.id),
        mentionHandle: `@${app.slug}`,
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
        const id = params.installation_id;
        const installation = await asApp<{ id: number; account?: { login?: string } }>(
          `/app/installations/${encodeURIComponent(id)}`,
        );
        const account = installation.account?.login ?? "";
        const known = (settings.installations ?? []).filter((one) => one.id !== String(id));
        return {
          config: { installations: [...known, { id: String(installation.id), account }] },
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

      /** Every repository the App can see, one installation at a time. */
      async listContainers(): Promise<Container[]> {
        const containers: Container[] = [];
        for (const installation of settings.installations ?? []) {
          const token = await tokenForInstallation(installation.id);
          const page = await call<{
            repositories: { full_name: string; name: string; default_branch?: string | null }[];
          }>(`/installation/repositories?per_page=100`, { token });
          for (const repository of page.repositories) {
            // With the branch it defaults to, which is what a Run starts from
            // once the repository is bound as a Project's code (forgeBindingOf).
            containers.push({
              scope: {
                scopeKey: repository.full_name,
                ...(repository.default_branch ? { baseBranch: repository.default_branch } : {}),
              },
              scopeKey: repository.full_name,
              name: repository.full_name,
            });
          }
        }
        return containers;
      },
    },

    /**
     * The repository behind a Project (ADR-0014, ADR-0019).
     *
     * A Run clones with an installation token that lives an hour and reaches
     * one repository: it is minted per Run, it never touches `.git/config`,
     * and a Run resumed after a Gate mints another. The pull request is opened
     * by deevy rather than by the Agent's session, so the credential never has
     * to be one that could open one.
     */
    forge: {
      async credential(scope: Scope): Promise<ForgeCredential> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const minted = await mintedFor(await installationIdFor(scopeKey));
        const repository = await call<{ clone_url: string }>(`/repos/${owner}/${repo}`, {
          token: minted.token,
        });
        return {
          cloneUrl: repository.clone_url,
          // GitHub's own name for an installation token used over HTTPS. The
          // token is the password; this is the user it goes with.
          username: "x-access-token",
          secret: minted.token,
          expiresAt: new Date(minted.expiresAt),
        };
      },

      async openPullRequest(
        scope: Scope,
        draft: PullRequestDraft,
      ): Promise<{ url: string; number: number }> {
        const { owner, repo, scopeKey } = repositoryOf(scope);
        const opened = await asInstallation<{ html_url: string; number: number }>(
          scopeKey,
          `/repos/${owner}/${repo}/pulls`,
          {
            method: "POST",
            body: JSON.stringify({
              head: draft.head,
              base: draft.base,
              title: draft.title,
              body: draft.body,
            }),
          },
        );
        return { url: opened.html_url, number: opened.number };
      },
    },
  };
}

/** Forgets every cached token. A test that mints one twice calls it first. */
export function resetGithubTokens(): void {
  tokens.clear();
  installations.clear();
}

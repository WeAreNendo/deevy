import {
  parseRulingCommand,
  type ExternalActor,
  type ExternalComment,
  type ExternalIssue,
  type InboundEvent,
} from "@deevy/core/sockets";

/**
 * Reading GitHub's webhook payloads (ADR-0024).
 *
 * Pure, and separate from the HTTP client on purpose: what a delivery means is
 * the half deevy can prove against recorded payloads with no network, no
 * clock and no credential, and it is the half that breaks when a provider
 * changes its shape.
 */

/** Only the fields deevy reads. GitHub sends a great deal more. */
interface GithubUser {
  login?: unknown;
  id?: unknown;
  type?: unknown;
}

interface GithubIssue {
  node_id?: unknown;
  id?: unknown;
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  state_reason?: unknown;
  labels?: unknown;
  assignees?: unknown;
  user?: unknown;
  html_url?: unknown;
  updated_at?: unknown;
  pull_request?: unknown;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): string =>
  typeof value === "number" ? String(value) : typeof value === "string" ? value : "";

/** Whoever did it on GitHub's side. A bot is marked, which is what the loop guard reads. */
export function actorOf(user: unknown): ExternalActor {
  const found = (user ?? {}) as GithubUser;
  const login = text(found.login);
  return { login, id: num(found.id), isBot: text(found.type) === "Bot" || login.endsWith("[bot]") };
}

/** `acme/deevy`, which is both GitHub's own word for a repository and deevy's scope key. */
function repositoryOf(payload: Record<string, unknown>): string {
  const repository = (payload.repository ?? {}) as { full_name?: unknown };
  return text(repository.full_name);
}

/**
 * One GitHub issue as deevy projects it.
 *
 * The id is the node id rather than the number: a number belongs to a
 * repository and changes when an issue is transferred, and deevy's projection
 * has to survive that. The key and the URL are what a Human reads, and both
 * carry the number, which is the point of them.
 */
export function issueOf(repository: string, issue: unknown): ExternalIssue | null {
  const found = (issue ?? {}) as GithubIssue;
  const number = num(found.number);
  const externalId = text(found.node_id) || num(found.id);
  if (!externalId || !number || !repository) return null;

  const labels = Array.isArray(found.labels)
    ? found.labels
        .map((label) =>
          typeof label === "string" ? label : text((label as { name?: unknown }).name),
        )
        .filter((label) => label.length > 0)
    : [];
  const assignees = Array.isArray(found.assignees)
    ? found.assignees.map((user) => {
        const actor = actorOf(user);
        return { login: actor.login, id: actor.id };
      })
    : [];
  const state = text(found.state) === "closed" ? ("closed" as const) : ("open" as const);
  return {
    externalId,
    key: `${repository}#${number}`,
    url: text(found.html_url) || `https://github.com/${repository}/issues/${number}`,
    title: text(found.title),
    body: typeof found.body === "string" ? found.body : null,
    state,
    // GitHub's own word for why, where it has one: `completed`, `not_planned`.
    stateName: text(found.state_reason) || state,
    assignees,
    labels,
    parentExternalId: null,
    updatedAt: new Date(text(found.updated_at) || Date.now()),
  };
}

/** Whether this is really a pull request, which GitHub lists among its issues. */
export function isPullRequest(issue: unknown): boolean {
  return Boolean((issue as GithubIssue | null)?.pull_request);
}

export function commentOf(comment: unknown): ExternalComment | null {
  const found = (comment ?? {}) as {
    node_id?: unknown;
    id?: unknown;
    body?: unknown;
    html_url?: unknown;
    created_at?: unknown;
    user?: unknown;
  };
  const externalId = text(found.node_id) || num(found.id);
  if (!externalId) return null;
  return {
    externalId,
    url: text(found.html_url),
    body: text(found.body),
    author: actorOf(found.user),
    createdAt: new Date(text(found.created_at) || Date.now()),
  };
}

/** The actions deevy acts on. Everything else is a delivery it says nothing about. */
const issueActions = new Set([
  "opened",
  "edited",
  "closed",
  "reopened",
  "labeled",
  "unlabeled",
  "assigned",
  "unassigned",
  "transferred",
  "reopened",
  "milestoned",
  "demilestoned",
]);

/** What one delivery means. Pure: the payload in, deevy's own events out. */
export function normalizeGithub(eventName: string, payload: unknown): InboundEvent[] {
  const body = (payload ?? {}) as Record<string, unknown>;
  const action = text(body.action);

  if (eventName === "ping") return [{ kind: "ignored", why: "a ping" }];

  if (eventName === "issues") {
    if (!issueActions.has(action)) {
      return [{ kind: "ignored", why: `an issues delivery deevy does not act on: ${action}` }];
    }
    const issue = issueOf(repositoryOf(body), body.issue);
    if (!issue) return [{ kind: "ignored", why: "an issues delivery with no issue in it" }];
    return [{ kind: "issue", scopeKey: repositoryOf(body), issue, actor: actorOf(body.sender) }];
  }

  if (eventName === "issue_comment") {
    if (action !== "created") {
      return [
        { kind: "ignored", why: `an issue_comment delivery deevy does not act on: ${action}` },
      ];
    }
    const comment = commentOf(body.comment);
    const issue = issueOf(repositoryOf(body), body.issue);
    if (!comment || !issue) {
      return [{ kind: "ignored", why: "an issue_comment delivery with no comment in it" }];
    }
    const ruling = parseRulingCommand(comment.body);
    const scopeKey = repositoryOf(body);
    if (ruling) {
      return [
        {
          kind: "ruling",
          scopeKey,
          issueExternalId: issue.externalId,
          comment,
          decision: ruling.decision,
          note: ruling.note,
        },
      ];
    }
    return [{ kind: "comment", scopeKey, issueExternalId: issue.externalId, comment }];
  }

  if (eventName === "sub_issues") {
    // The one place GitHub tells deevy about a tree. `removed` carries the
    // same pair, so the child comes back with no parent.
    const added = action === "sub_issue_added";
    if (!added && action !== "sub_issue_removed") {
      return [{ kind: "ignored", why: `a sub_issues delivery deevy does not act on: ${action}` }];
    }
    const repository = repositoryOf(body);
    const child = issueOf(repository, body.sub_issue);
    const parent = issueOf(repository, body.parent_issue);
    if (!child) return [{ kind: "ignored", why: "a sub_issues delivery with no sub-issue in it" }];
    return [
      {
        kind: "issue",
        scopeKey: repository,
        issue: { ...child, parentExternalId: added ? (parent?.externalId ?? null) : null },
        actor: actorOf(body.sender),
      },
    ];
  }

  if (eventName === "installation" || eventName === "installation_repositories") {
    const installation = (body.installation ?? {}) as { id?: unknown; account?: unknown };
    const account = (installation.account ?? {}) as { login?: unknown };
    const id = num(installation.id);
    if (!id) return [{ kind: "ignored", why: "an installation delivery with no installation" }];
    // A deleted installation is still news: the config says where the App is,
    // and an entry that is gone is one deevy should stop offering.
    if (action === "deleted") {
      return [{ kind: "ignored", why: `the App was removed from ${text(account.login)}` }];
    }
    return [{ kind: "installation", installations: [{ id, account: text(account.login) }] }];
  }

  return [{ kind: "ignored", why: `a ${eventName} delivery, which deevy does not read` }];
}

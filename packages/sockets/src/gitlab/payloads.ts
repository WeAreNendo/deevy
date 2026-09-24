import {
  parseRulingCommand,
  type ExternalActor,
  type ExternalComment,
  type ExternalIssue,
  type InboundEvent,
} from "@deevy/core/sockets";

/**
 * Reading what GitLab says (ADR-0024).
 *
 * Pure, and apart from the HTTP client for the reason GitHub's and Linear's
 * are: what a delivery means is the half deevy proves against recorded
 * payloads with no network, and the half that breaks when a provider changes
 * its shape.
 *
 * GitLab describes an issue two ways — a webhook's `object_attributes`, with
 * the project and the labels beside it, and REST v4's issue, which carries its
 * own reference — and both are read here so a delivery and a poll project the
 * same record the same way.
 */

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): string =>
  typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * GitLab's clocks, in either of its two spellings: REST and issue webhooks say
 * `2026-09-24T09:14:05Z`, comment webhooks `2026-09-24 09:14:05 UTC`.
 */
export function gitlabDate(value: unknown): Date {
  const said = text(value).trim();
  if (!said) return new Date();
  const iso = said.replace(/ UTC$/, "Z").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * The bot user GitLab makes for a project or group access token — the user a
 * Socket connected with one of those acts as, and the kind of account whose
 * words rule nothing (ADR-0025).
 */
const BOT_USERNAME = /^(project|group)_\d+_bot/;

/**
 * Whoever did it on GitLab's side. GitLab redacts a user's address in a
 * webhook, so none is claimed from one.
 */
export function actorOf(user: unknown): ExternalActor | null {
  const found = record(user);
  const id = num(found.id);
  if (!id) return null;
  const login = text(found.username);
  const email = text(found.email);
  return {
    login,
    id,
    isBot: found.bot === true || BOT_USERNAME.test(login),
    ...(email.includes("@") ? { email } : {}),
  };
}

/** Labels as names: a webhook sends objects with a `title`, REST sends strings. */
function labelsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label) => (typeof label === "string" ? label : text(record(label).title)))
    .filter((name) => name.length > 0);
}

function assigneesOf(value: unknown): { login: string; id: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((user) => ({ login: text(record(user).username), id: num(record(user).id) }))
    .filter((user) => user.id.length > 0);
}

/**
 * One GitLab issue as deevy projects it, from a webhook or from REST.
 *
 * The id is GitLab's global one, which survives a move to another project;
 * the key is the reference a Human types (`acme/deevy#42`), which does not.
 * GitLab has no parent for an issue — an epic is a group's, and a task is a
 * work item deevy does not read — so deevy keeps the tree itself.
 */
export function issueOf(
  issue: unknown,
  context: { path?: string; labels?: unknown; assignees?: unknown } = {},
): ExternalIssue | null {
  const found = record(issue);
  const externalId = num(found.id);
  const iid = num(found.iid);
  const url = text(found.web_url) || text(found.url);
  const reference = text(record(found.references).full);
  const path = context.path ?? "";
  const key = reference || (path && iid ? `${path}#${iid}` : "");
  if (!externalId || !key) return null;
  const state = text(found.state) === "closed" ? "closed" : "open";
  return {
    externalId,
    key,
    url,
    title: text(found.title),
    body: typeof found.description === "string" ? found.description : null,
    state,
    // GitLab has two states and no names for them; a team's own workflow is
    // in its scoped labels, which arrive as labels.
    stateName: state,
    assignees: assigneesOf(context.assignees ?? found.assignees),
    labels: labelsOf(context.labels ?? found.labels),
    parentExternalId: null,
    updatedAt: gitlabDate(found.updated_at),
  };
}

/** One comment, from a webhook's note or REST's. */
export function commentOf(note: unknown, author: unknown, issueUrl = ""): ExternalComment | null {
  const found = record(note);
  const externalId = num(found.id);
  const who = actorOf(author);
  if (!externalId || !who) return null;
  return {
    externalId,
    url: text(found.url) || (issueUrl ? `${issueUrl}#note_${externalId}` : ""),
    body: text(found.note) || text(found.body),
    author: who,
    createdAt: gitlabDate(found.created_at),
  };
}

/** What one delivery means. Pure: the payload in, deevy's own events out. */
export function normalizeGitlab(eventName: string, payload: unknown): InboundEvent[] {
  const body = record(payload);
  const kind = text(body.object_kind) || eventName;
  const project = record(body.project);
  const scopeKey = num(project.id) || num(body.project_id);
  const path = text(project.path_with_namespace);

  if (kind === "issue") {
    const issue = issueOf(body.object_attributes, {
      path,
      labels: body.labels ?? record(body.object_attributes).labels,
      assignees: body.assignees ?? [],
    });
    if (!issue) return [{ kind: "ignored", why: "an issue delivery with no issue in it" }];
    return [{ kind: "issue", scopeKey, issue, actor: actorOf(body.user) }];
  }

  if (kind === "note") {
    const note = record(body.object_attributes);
    if (text(note.noteable_type) !== "Issue") {
      return [
        {
          kind: "ignored",
          why: `a comment on a ${text(note.noteable_type) || "thing"}, not an issue`,
        },
      ];
    }
    // What GitLab writes itself — "added ~bug label" — is a record, not a
    // Human saying something.
    if (note.system === true) return [{ kind: "ignored", why: "a note GitLab wrote itself" }];
    // deevy acts on what was said first: the Gate is the authority, and an
    // edited comment changes nothing that was ruled on (ADR-0025).
    const action = text(note.action);
    if (action && action !== "create") {
      return [{ kind: "ignored", why: `a note delivery deevy does not act on: ${action}` }];
    }
    const issue = record(body.issue);
    const issueExternalId = num(issue.id) || num(note.noteable_id);
    const comment = commentOf(note, body.user, text(issue.url));
    if (!comment || !issueExternalId) {
      return [{ kind: "ignored", why: "a note delivery that is not on an issue" }];
    }
    const ruling = parseRulingCommand(comment.body);
    if (ruling) {
      return [
        {
          kind: "ruling",
          scopeKey,
          issueExternalId,
          comment,
          decision: ruling.decision,
          note: ruling.note,
        },
      ];
    }
    return [{ kind: "comment", scopeKey, issueExternalId, comment }];
  }

  return [{ kind: "ignored", why: `a ${kind} delivery, which deevy does not read` }];
}

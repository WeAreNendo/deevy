import {
  parseRulingCommand,
  type ExternalActor,
  type ExternalComment,
  type ExternalIssue,
  type InboundEvent,
} from "@deevy/core/sockets";

/**
 * Reading what Linear says (ADR-0024).
 *
 * Pure, and apart from the HTTP client for the reason GitHub's is: what a
 * delivery means is the half deevy proves against recorded payloads with no
 * network, and the half that breaks when a provider changes its shape.
 *
 * Linear describes a record two ways — a webhook's `data`, flat with ids and a
 * few objects beside them, and its GraphQL API's nodes, which nest — and both
 * are read here so a delivery and a poll project the same record the same way.
 */

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * The kinds of workflow state a Linear team can name however it likes. Two of
 * them are finished, whatever they are called — a team's "Shipped" and its
 * "Won't do" are both closed as far as work is concerned.
 */
const CLOSED_TYPES = new Set(["completed", "canceled"]);

/**
 * Whoever did it on Linear's side. A webhook's `actor` says what kind of thing
 * it was, and anything that is not a person — an OAuth app, deevy's own among
 * them, or an integration — is a machine, whose words rule nothing.
 */
export function actorOf(actor: unknown): ExternalActor | null {
  const found = record(actor);
  const id = text(found.id);
  if (!id) return null;
  const email = text(found.email);
  return {
    login: text(found.displayName) || text(found.name),
    id,
    isBot: text(found.type) !== "" && text(found.type) !== "user",
    ...(email ? { email } : {}),
  };
}

/** Linear's labels, as names: a webhook sends objects, the API a connection of them. */
function labelsOf(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(record(value).nodes)
      ? (record(value).nodes as unknown[])
      : [];
  return list.map((label) => text(record(label).name)).filter((name) => name.length > 0);
}

/**
 * One Linear issue as deevy projects it, from a webhook's `data` or an API node.
 *
 * The id is Linear's own, which survives a move to another team; the key is
 * the identifier a Human types (`ENG-12`), which does not.
 */
export function issueOf(issue: unknown): ExternalIssue | null {
  const found = record(issue);
  const externalId = text(found.id);
  const key = text(found.identifier);
  if (!externalId || !key) return null;

  const state = record(found.state);
  const assignee = record(found.assignee);
  const assigneeId = text(assignee.id) || text(found.assigneeId);
  const parentId = text(found.parentId) || text(record(found.parent).id);
  const delegateId = text(found.delegateId) || text(record(found.delegate).id);
  return {
    externalId,
    key,
    url: text(found.url),
    title: text(found.title),
    body: typeof found.description === "string" ? found.description : null,
    state: CLOSED_TYPES.has(text(state.type)) ? "closed" : "open",
    stateName: text(state.name) || "open",
    assignees: assigneeId
      ? [{ login: text(assignee.displayName) || text(assignee.name), id: assigneeId }]
      : [],
    labels: labelsOf(found.labels),
    parentExternalId: parentId || null,
    delegateId: delegateId || null,
    updatedAt: new Date(text(found.updatedAt) || Date.now()),
  };
}

/** The team a record belongs to, which is the container a Project is bound to. */
export function teamOf(issue: unknown): string {
  const found = record(issue);
  return text(found.teamId) || text(record(found.team).id);
}

/**
 * A comment's bot actor, whichever way Linear sent it: an object from the API,
 * a string from a webhook — Linear's schema types it so — holding the same
 * thing as JSON, or just a name. Null where there is none.
 */
function botActorOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : { name: value };
    } catch {
      return { name: value };
    }
  }
  const found = record(value);
  return Object.keys(found).length > 0 ? found : null;
}

/**
 * One comment. Its author is the user who wrote it; a comment an app or an
 * integration wrote carries a `botActor`, which makes it a machine's whatever
 * else it says, and an app with no user at all has only an id.
 */
export function commentOf(comment: unknown, url = ""): ExternalComment | null {
  const found = record(comment);
  const externalId = text(found.id);
  if (!externalId) return null;
  const user = record(found.user);
  const authorId = text(user.id) || text(found.userId);
  const email = text(user.email);
  const bot = botActorOf(found.botActor);
  const isBot = bot !== null || !text(user.id);
  return {
    externalId,
    url: text(found.url) || url,
    body: text(found.body),
    author: {
      login: text(user.displayName) || text(user.name) || text(bot?.name),
      id: authorId,
      isBot,
      ...(email ? { email } : {}),
    },
    createdAt: new Date(text(found.createdAt) || Date.now()),
  };
}

/** What one delivery means. Pure: the payload in, deevy's own events out. */
export function normalizeLinear(eventName: string, payload: unknown): InboundEvent[] {
  const body = record(payload);
  const type = text(body.type) || eventName;
  const action = text(body.action);
  const actor = actorOf(body.actor);

  if (type === "Issue") {
    const issue = issueOf(body.data);
    if (!issue) return [{ kind: "ignored", why: "an Issue delivery with no issue in it" }];
    // A deleted record is one nothing should go on working: it is closed here,
    // which is also what tells a parent waiting on it (ADR-0022).
    const removed = action === "remove";
    return [
      {
        kind: "issue",
        scopeKey: teamOf(body.data),
        issue: removed ? { ...issue, state: "closed", stateName: "Deleted" } : issue,
        actor,
      },
    ];
  }

  if (type === "Comment") {
    // deevy acts on what was said first: the Gate is the authority, and an
    // edited comment changes nothing that was ruled on (ADR-0025).
    if (action !== "create") {
      return [{ kind: "ignored", why: `a Comment delivery deevy does not act on: ${action}` }];
    }
    const data = record(body.data);
    const comment = commentOf(data, text(body.url));
    const issueExternalId = text(data.issueId) || text(record(data.issue).id);
    if (!comment || !issueExternalId) {
      return [{ kind: "ignored", why: "a Comment delivery that is not on an issue" }];
    }
    // The webhook's own actor is the surer word on whether a machine wrote it.
    const author = actor?.isBot ? { ...comment.author, isBot: true } : comment.author;
    const scopeKey = teamOf(data.issue);
    const said = { ...comment, author };
    const ruling = parseRulingCommand(said.body);
    if (ruling) {
      return [
        {
          kind: "ruling",
          scopeKey,
          issueExternalId,
          comment: said,
          decision: ruling.decision,
          note: ruling.note,
        },
      ];
    }
    return [{ kind: "comment", scopeKey, issueExternalId, comment: said }];
  }

  if (type === "OAuthApp") {
    return [{ kind: "ignored", why: `the app's access to Linear was ${action || "changed"}` }];
  }
  return [{ kind: "ignored", why: `a ${type} delivery, which deevy does not read` }];
}

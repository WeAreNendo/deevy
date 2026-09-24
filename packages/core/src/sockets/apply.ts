import {
  member as memberTable,
  projectGrant,
  socket as socketTable,
  type Db,
  type Issue,
  type Project,
  type Socket,
  type Workspace,
} from "@deevy/db";
import { and, eq, isNull } from "drizzle-orm";
import { appendEvent, type EventSource } from "../events.ts";
import type { JobQueue } from "../jobs.ts";
import { routeIssueTo, upsertProjection } from "../issues.ts";
import { resolveMentions } from "../mentions.ts";
import {
  parseRulingCommand,
  type IdentityScope,
  type InboundEvent,
  type TrackerSocket,
} from "./port.ts";
import { scopeKeyOf } from "./registry.ts";
import { applyRuling } from "./rulings.ts";

/**
 * What a tracker saying something does inside deevy (ADR-0024).
 *
 * One function, because a delivery and a poll must mean the same thing: a
 * webhook arrives on a public instance and a poll catches up on a laptop, and a
 * team should not have two behaviours depending on which one their instance
 * has. The route verifies and records; this decides.
 *
 * Nothing here throws for an event it cannot use. A container nobody bound, a
 * record nobody projected, a delivery that arrived late — each is a sentence
 * put in the delivery row, because a provider that gets a 500 disables the
 * hook, and deevy failing to place one record is not a reason to stop hearing
 * about the rest.
 */

export interface ApplyInboundOptions {
  db: Db;
  workspace: Pick<Workspace, "id">;
  /** The Socket the delivery arrived on, with its identity and config. */
  socket: Socket;
  events: InboundEvent[];
  /** Where the Events this writes nudge their deliveries (jobs.ts). */
  jobs?: JobQueue;
  /**
   * Where the tool's accounts live, which is what a Ruling's author is looked
   * up in (identities.ts). The provider module knows; absent, the provider's
   * own name is the instance and nothing is shared with sign-in.
   */
  identityScope?: IdentityScope;
  /**
   * What reads a record or a comment back, for a tool whose deliveries only
   * name one (`changed`, `commented`): Notion's. Absent, those are skipped.
   */
  tracker?: TrackerSocket;
  now?: () => Date;
}

export interface ApplyInboundResult {
  /** Events that changed something in deevy. */
  applied: number;
  /** Why each of the others meant nothing, in the delivery's own words. */
  skipped: string[];
}

/**
 * The fields a reader of the log is told about, in the order they are said.
 * Ordered by how much a change to one matters to somebody reading a feed: what
 * it is called, what it says, how it is tagged, who the tracker has on it, and
 * whether it is still open.
 */
const watched = ["title", "body", "labels", "assignees", "state", "key", "url"] as const;

export async function applyInbound({
  db,
  workspace,
  socket,
  events,
  jobs,
  identityScope,
  tracker,
  now = () => new Date(),
}: ApplyInboundOptions): Promise<ApplyInboundResult> {
  const source: EventSource = { db, workspace, member: null, ...(jobs ? { jobs } : {}) };
  // One delivery often carries several events about one container, and the
  // Project behind it is the same row every time.
  const projects = new Map<string, Project | null>();
  const result: ApplyInboundResult = { applied: 0, skipped: [] };

  const scope = identityScope ?? { instance: socket.provider };
  for (const event of events) {
    const why = await applyOne(
      { db, socket, source, projects, scope, now, ...(tracker ? { tracker } : {}) },
      event,
    );
    if (why === null) result.applied += 1;
    else result.skipped.push(why);
  }
  return result;
}

interface Applying {
  db: Db;
  socket: Socket;
  source: EventSource;
  projects: Map<string, Project | null>;
  scope: IdentityScope;
  tracker?: TrackerSocket;
  now: () => Date;
}

/** Applies one event, answering null when it changed something and why when it did not. */
async function applyOne(applying: Applying, event: InboundEvent): Promise<string | null> {
  if (event.kind === "changed" || event.kind === "commented") {
    const read = await readBack(applying, event);
    return typeof read === "string" ? read : applyOne(applying, read);
  }
  if (event.kind === "issue") return applyIssue(applying, event);
  if (event.kind === "comment") return applyComment(applying, event);
  if (event.kind === "installation") return applyInstallation(applying, event);
  if (event.kind === "ruling") {
    return applyRuling({
      source: applying.source,
      socket: applying.socket,
      scope: applying.scope,
      event,
    });
  }
  return event.why;
}

/**
 * What a delivery that only named something turns into once it is read back:
 * the `issue`, `comment` or `ruling` event the tool would have sent had it
 * said it — or why it could not be read.
 *
 * A record is read through the Project its container is bound to, so the
 * binding's own words (which property is the status, which values are closed)
 * decide what it says. A comment is read through the Project of the record it
 * is on, and a `/approve` in it is a Ruling like any other (ADR-0025).
 */
async function readBack(
  applying: Applying,
  event: Extract<InboundEvent, { kind: "changed" | "commented" }>,
): Promise<InboundEvent | string> {
  const { tracker } = applying;
  if (!tracker)
    return `${applying.socket.name} said something changed and there is nothing to read it with`;

  if (event.kind === "changed") {
    const project = await projectFor(applying, event.scopeKey);
    if (!project) return `No Project is bound to ${event.scopeKey}`;
    const known = await applying.db.query.issue.findFirst({
      where: { socketId: applying.socket.id, externalId: event.issueExternalId },
      columns: { url: true },
    });
    const issue = await tracker.getIssue(project.trackerScope, {
      externalId: event.issueExternalId,
      url: known?.url ?? "",
    });
    return { kind: "issue", scopeKey: event.scopeKey, issue, actor: event.actor };
  }

  const issue = await applying.db.query.issue.findFirst({
    where: { socketId: applying.socket.id, externalId: event.issueExternalId },
    with: { project: { columns: { trackerScope: true } } },
  });
  if (!issue) return `No record ${event.issueExternalId} has been projected here`;
  if (!tracker.getComment) return `${applying.socket.name} cannot read a comment back`;
  const comment = await tracker.getComment(
    issue.project.trackerScope,
    { externalId: issue.externalId, url: issue.url },
    event.commentExternalId,
  );
  if (!comment) return `Comment ${event.commentExternalId} is not there any more`;
  const ruling = parseRulingCommand(comment.body);
  return ruling
    ? {
        kind: "ruling",
        scopeKey: "",
        issueExternalId: issue.externalId,
        comment,
        decision: ruling.decision,
        note: ruling.note,
      }
    : { kind: "comment", scopeKey: "", issueExternalId: issue.externalId, comment };
}

async function projectFor(applying: Applying, scopeKey: string): Promise<Project | null> {
  const stored = scopeKeyOf(applying.socket.provider, { scopeKey });
  const known = applying.projects.get(stored);
  if (known !== undefined) return known;
  const found =
    (await applying.db.query.project.findFirst({
      where: { trackerSocketId: applying.socket.id, trackerScopeKey: stored },
    })) ?? null;
  applying.projects.set(stored, found);
  return found;
}

async function applyIssue(
  applying: Applying,
  event: Extract<InboundEvent, { kind: "issue" }>,
): Promise<string | null> {
  const { db, socket, source } = applying;
  const project = await projectFor(applying, event.scopeKey);
  if (!project) return `No Project is bound to ${event.scopeKey}`;

  const external = event.issue;
  const before = await db.query.issue.findFirst({
    where: { socketId: socket.id, externalId: external.externalId },
  });
  // Where the tracker cannot link a sub-issue natively, deevy keeps the tree
  // itself, so the parent is looked up once — when the record is first seen.
  const parentId = before
    ? before.parentId
    : ((await parentRow(db, socket.id, external.parentExternalId))?.id ?? null);

  const { issue, created, applied } = await upsertProjection(db, {
    projectId: project.id,
    socketId: socket.id,
    external,
    parentId,
  });
  if (!applied) return `${external.key} arrived after a newer delivery, so nothing changed`;

  const actor = event.actor?.login ?? null;
  await appendEvent(source, {
    kind: created ? "issue.created" : "issue.synced",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: project.id,
    payload: {
      key: issue.externalKey,
      url: issue.url,
      ...(created ? {} : { changed: changedFields(before, issue) }),
      ...(actor ? { externalActor: actor } : {}),
    },
  });

  if (before && before.state !== issue.state) {
    await appendEvent(source, {
      kind: issue.state === "closed" ? "issue.closed" : "issue.reopened",
      subjectType: "issue",
      subjectId: issue.id,
      projectId: project.id,
      payload: { key: issue.externalKey, ...(actor ? { externalActor: actor } : {}) },
    });
  }

  await route(applying, project, issue, external.delegateId ?? null);
  return null;
}

function parentRow(db: Db, socketId: string, parentExternalId: string | null) {
  if (!parentExternalId) return Promise.resolve(undefined);
  return db.query.issue.findFirst({
    where: { socketId, externalId: parentExternalId },
    columns: { id: true },
  });
}

/** What the tracker said differently this time, for somebody reading the feed. */
function changedFields(before: Issue | undefined, after: Issue): string[] {
  if (!before) return [];
  const changed: string[] = [];
  for (const field of watched) {
    const same =
      field === "labels" || field === "assignees"
        ? JSON.stringify(before[field]) === JSON.stringify(after[field])
        : field === "state"
          ? before.state === after.state && before.stateName === after.stateName
          : field === "key"
            ? before.externalKey === after.externalKey
            : before[field] === after[field];
    if (!same) changed.push(field);
  }
  return changed;
}

/**
 * Who deevy hands this record to.
 *
 * A GitHub App cannot be an assignee and a Linear app is not a person, so the
 * tracker's own assignee is a fact deevy mirrors rather than the thing that
 * puts an Agent to work. What routes is a label an admin chose the prefix of;
 * then the tracker handing the record to deevy itself — Linear's delegate,
 * which is what assigning an issue to an app sets — which is the default
 * Agent's to answer; and the Project's default Agent for anything nobody named.
 */
async function route(
  applying: Applying,
  project: Project,
  issue: Issue,
  delegateId: string | null,
): Promise<void> {
  // Closed is closed: there is no work to hand anybody, and a record that
  // closes while routed keeps who was on it for the feed to read.
  if (issue.state === "closed") return;

  const target = await routedMember(applying, project, issue, delegateId);
  if (!target || target === issue.assigneeMemberId) return;
  if (!(await routeIssueTo(applying.db, issue.id, target))) return;

  await appendEvent(applying.source, {
    kind: "issue.assigned",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: project.id,
    // What turns this into a Run is the unchanged `issue.assigned` arm of
    // `triggersFor`; `byRouting` is how a reader knows nobody clicked.
    payload: { from: issue.assigneeMemberId, to: target, byRouting: true },
  });
}

async function routedMember(
  applying: Applying,
  project: Project,
  issue: Issue,
  delegateId: string | null,
): Promise<string | null> {
  const prefix = project.routing.labelPrefix;
  if (prefix) {
    for (const label of issue.labels) {
      if (!label.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const handle = label.slice(prefix.length).trim().toLowerCase();
      const named = handle ? await grantedAgent(applying.db, project, handle) : null;
      if (named) return named;
    }
  }
  // Handed to deevy by name, in the tracker's own words: that takes it off
  // whoever had it, the way a label does, and gives it to the default.
  if (delegateId && delegateId === applying.socket.identity.id && project.defaultAgentMemberId) {
    return project.defaultAgentMemberId;
  }
  // The default fills a gap rather than taking a record off somebody: a record
  // already routed keeps the Agent it has until a label says otherwise.
  if (issue.assigneeMemberId) return null;
  return project.defaultAgentMemberId;
}

/** The Agent that handle names, if it may see this Project at all. */
async function grantedAgent(db: Db, project: Project, handle: string): Promise<string | null> {
  const [found] = await db
    .select({ id: memberTable.id })
    .from(memberTable)
    .innerJoin(projectGrant, eq(projectGrant.memberId, memberTable.id))
    .where(
      and(
        eq(memberTable.workspaceId, project.workspaceId),
        eq(memberTable.handle, handle),
        eq(memberTable.kind, "agent"),
        isNull(memberTable.suspendedAt),
        eq(projectGrant.projectId, project.id),
      ),
    )
    .limit(1);
  return found?.id ?? null;
}

async function applyComment(
  applying: Applying,
  event: Extract<InboundEvent, { kind: "comment" }>,
): Promise<string | null> {
  const { db, socket, source } = applying;
  const author = event.comment.author;
  // The loop guard, and the whole of it: deevy's own mirrored comment comes
  // back as a delivery, and a mention inside it was already acted on when it
  // was written (operations/comments.ts).
  if (author.id === socket.identity.id || author.login === socket.identity.login) {
    return `${socket.name} wrote this comment itself`;
  }

  const issue = await db.query.issue.findFirst({
    where: { socketId: socket.id, externalId: event.issueExternalId },
  });
  if (!issue) return `No record ${event.issueExternalId} has been projected here`;

  const mentioned = await resolveMentions(
    db,
    applying.source.workspace.id,
    event.comment.body,
    socket.identity.mentionHandle,
  );
  await appendEvent(source, {
    kind: "comment.created",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: issue.projectId,
    payload: {
      externalCommentId: event.comment.externalId,
      url: event.comment.url,
      body: event.comment.body,
      mentionedMemberIds: mentioned,
      externalActor: author.login,
    },
  });
  return null;
}

async function applyInstallation(
  applying: Applying,
  event: Extract<InboundEvent, { kind: "installation" }>,
): Promise<string | null> {
  const { db, socket, source } = applying;
  const known = Array.isArray(socket.config.installations)
    ? (socket.config.installations as { id: string; account: string }[])
    : [];
  const merged = [...known];
  const added: { id: string; account: string }[] = [];
  for (const installation of event.installations) {
    const at = merged.findIndex((one) => one.id === installation.id);
    if (at === -1) {
      merged.push(installation);
      added.push(installation);
    } else merged[at] = installation;
  }

  const config = { ...socket.config, installations: merged };
  await db
    .update(socketTable)
    .set({ config, updatedAt: applying.now() })
    .where(eq(socketTable.id, socket.id));
  // The row this call was handed is what the rest of the delivery reads.
  applying.socket = { ...socket, config };

  await appendEvent(source, {
    kind: "socket.installation_added",
    subjectType: "socket",
    subjectId: socket.id,
    payload: {
      name: socket.name,
      accounts: (added.length > 0 ? added : event.installations).map((one) => one.account),
    },
  });
  return null;
}

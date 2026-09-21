import {
  agent as agentTable,
  member as memberTable,
  user as userTable,
  webhookSubscription,
  type Db,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appendEvent, type EventSource } from "./events.ts";
import { allocateHandle } from "./handles.ts";
import { MemberSchema, UserSchema } from "./schemas.ts";
import { newId } from "./ids.ts";

/**
 * An Agent is a Member like any other (CONTEXT.md): a Better Auth user with
 * `kind: "agent"`, a `member` row carrying its Sponsor, and one `agent` row for
 * what only an Agent has. This module holds the writes that keep the three in
 * step, so an operation reads as the rule it enforces.
 */

/**
 * An Agent never signs in, so its Better Auth user has no password and no
 * account row; the email exists only because the column is unique and not null.
 * `.invalid` is reserved for names that must never resolve (RFC 2606).
 */
export function agentEmail(handle: string, workspaceSlug: string): string {
  return `${handle}@agents.${workspaceSlug}.invalid`;
}

export interface CreateAgentInput {
  db: Db;
  workspace: { id: string; slug: string };
  /** The Human who is accountable for it from this moment (CONTEXT.md). */
  sponsorMemberId: string;
  name: string;
  handle?: string | null;
}

/** Inserts the user, the Member and the Agent row, and returns the Member id. */
export async function createAgent(input: CreateAgentInput): Promise<string> {
  const handle = input.handle ?? (await allocateHandle(input.db, input.name));
  const userId = newId("user");
  const memberId = newId("member");
  await input.db.insert(userTable).values({
    id: userId,
    name: input.name,
    email: agentEmail(handle, input.workspace.slug),
    kind: "agent",
  });
  await input.db.insert(memberTable).values({
    id: memberId,
    workspaceId: input.workspace.id,
    userId,
    handle,
    role: "member",
    kind: "agent",
    sponsorId: input.sponsorMemberId,
  });
  await input.db.insert(agentTable).values({ memberId });
  return memberId;
}

/** A Member as the Agent list shows one: the row, the Human behind it, and its Sponsor. */
export const AgentSchema = MemberSchema.extend({
  user: UserSchema,
  sponsor: MemberSchema.extend({ user: UserSchema }).nullable(),
  webhookUrl: z.string().nullable(),
  scheduleMinutes: z.number().int().nullable(),
  /** The Projects it may see; an ungranted one does not exist to it (ADR-0004). */
  grantedProjectIds: z.array(z.string()),
});

export type AgentView = z.infer<typeof AgentSchema>;

/** Everything an Agent operation returns beyond the Member row itself. */
const withAgent = {
  user: true,
  agent: true,
  sponsor: { with: { user: true } },
  grantedProjects: { columns: { id: true } },
  // The URL lives on the subscription, because that is the row delivery reads.
  // Keeping a second copy on the Agent is how it came to be shown as saved
  // while nothing was ever sent to it (docs/plans/m2.md).
  subscriptions: { columns: { url: true, disabledAt: true } },
} as const;

/** Reads one Agent in the shape every Agent operation returns. */
export async function loadAgent(db: Db, memberId: string): Promise<AgentView | undefined> {
  const row = await db.query.member.findFirst({
    where: { id: memberId, kind: "agent" },
    with: withAgent,
  });
  return row ? view(row) : undefined;
}

/** Reads every Agent of the Workspace, oldest first. */
export async function listAgents(db: Db, workspaceId: string): Promise<AgentView[]> {
  const rows = await db.query.member.findMany({
    where: { workspaceId, kind: "agent" },
    with: withAgent,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(view);
}

/** The Member row as the query above reads it, before it is flattened. */
type AgentRow = Omit<AgentView, "webhookUrl" | "scheduleMinutes" | "grantedProjectIds"> & {
  agent: { scheduleMinutes: number | null } | null;
  grantedProjects: Array<{ id: string }>;
  subscriptions: Array<{ url: string; disabledAt: Date | null }>;
};

/** An Agent's own row is flattened onto the Member, so a surface reads one thing. */
function view(row: AgentRow): AgentView {
  const { agent, grantedProjects, subscriptions, ...member } = row;
  return {
    ...member,
    webhookUrl: subscriptions.find((row) => !row.disabledAt)?.url ?? null,
    scheduleMinutes: agent?.scheduleMinutes ?? null,
    grantedProjectIds: grantedProjects.map((project) => project.id),
  };
}

/**
 * Points an Agent's deliveries at a URL, or stops them when it is null. The
 * Agent's own subscription is the one row delivery reads, so setting the URL
 * here and having deevy deliver to it are the same act rather than two that
 * can disagree (docs/plans/m2.md).
 */
export async function setAgentWebhook(
  db: Db,
  memberId: string,
  workspaceId: string,
  url: string | null,
  secret?: string,
): Promise<void> {
  const existing = await db.query.webhookSubscription.findFirst({ where: { memberId } });
  if (!url) {
    if (existing) {
      await db
        .update(webhookSubscription)
        .set({ disabledAt: new Date() })
        .where(eq(webhookSubscription.id, existing.id));
    }
    return;
  }
  if (existing) {
    await db
      .update(webhookSubscription)
      .set({ url, disabledAt: null, ...(secret ? { secret } : {}) })
      .where(eq(webhookSubscription.id, existing.id));
    return;
  }
  // deevy never reads a secret back, so it cannot invent one either: a
  // generated secret would sign every delivery with a value the receiver has
  // no way to learn, and the signature would be decoration.
  if (!secret) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Give the secret deevy should sign this Agent's deliveries with",
    });
  }
  await db.insert(webhookSubscription).values({
    id: newId("webhook"),
    workspaceId,
    memberId,
    url,
    secret,
    createdBy: memberId,
  });
}

/** A handle names one Member (see handles.ts), so a rename looks there. */
export async function handleTaken(db: Db, handle: string): Promise<boolean> {
  const asMember = await db.query.member.findFirst({
    where: { handle },
    columns: { id: true },
  });
  return Boolean(asMember);
}

/**
 * A suspended Sponsor suspends the Agents it answers for (docs/PLAN.md). The
 * cascade marks its Events with the Sponsor it came from, so reinstating that
 * Human brings back only the Agents the cascade stopped and leaves the ones
 * their Sponsor stopped on purpose alone.
 */
export const CASCADE = "cascadedFrom";

/** The Agents a Sponsor answers for that are still working. */
export async function cascadeSuspendAgents(
  source: EventSource,
  sponsorMemberId: string,
): Promise<string[]> {
  const running = await source.db.query.member.findMany({
    where: { sponsorId: sponsorMemberId, kind: "agent", suspendedAt: { isNull: true } },
    columns: { id: true },
  });
  const ids = running.map((row) => row.id);
  if (ids.length === 0) return ids;

  await source.db
    .update(memberTable)
    .set({ suspendedAt: new Date() })
    .where(inArray(memberTable.id, ids));
  for (const id of ids) {
    await appendEvent(source, {
      kind: "member.suspended",
      subjectType: "member",
      subjectId: id,
      payload: { [CASCADE]: sponsorMemberId },
    });
  }
  return ids;
}

/** Reverses that cascade, and only that cascade. */
export async function cascadeReinstateAgents(
  source: EventSource,
  sponsorMemberId: string,
): Promise<string[]> {
  const stopped = await source.db.query.member.findMany({
    where: { sponsorId: sponsorMemberId, kind: "agent", suspendedAt: { isNotNull: true } },
    columns: { id: true },
  });
  const ids = await cascadedOf(
    source.db,
    stopped.map((row) => row.id),
    sponsorMemberId,
  );
  if (ids.length === 0) return ids;

  await source.db
    .update(memberTable)
    .set({ suspendedAt: null })
    .where(inArray(memberTable.id, ids));
  for (const id of ids) {
    await appendEvent(source, {
      kind: "member.reinstated",
      subjectType: "member",
      subjectId: id,
      payload: { [CASCADE]: sponsorMemberId },
    });
  }
  return ids;
}

/**
 * Of these suspended Agents, the ones whose last suspension was this Sponsor's
 * cascade. One statement over the Event log, which is the record (ADR-0003),
 * rather than a column or a query per Agent (docs/plans/m1.md).
 */
async function cascadedOf(db: Db, memberIds: string[], sponsorMemberId: string): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db.query.event.findMany({
    where: { kind: "member.suspended", subjectType: "member", subjectId: { in: memberIds } },
    columns: { subjectId: true, payload: true },
    orderBy: { seq: "desc" },
  });
  const latest = new Map<string, Record<string, unknown> | null>();
  for (const row of rows) {
    if (!latest.has(row.subjectId)) latest.set(row.subjectId, row.payload);
  }
  return memberIds.filter((id) => latest.get(id)?.[CASCADE] === sponsorMemberId);
}

/**
 * One Agent's half of cascadeReinstateAgents: it works again if the suspension
 * it carries came from the Sponsor it is leaving, and stays stopped if its
 * Sponsor stopped it deliberately.
 */
export async function liftCascade(
  source: EventSource,
  memberId: string,
  fromSponsorMemberId: string,
): Promise<boolean> {
  const [cascaded] = await cascadedOf(source.db, [memberId], fromSponsorMemberId);
  if (!cascaded) return false;

  await source.db
    .update(memberTable)
    .set({ suspendedAt: null })
    .where(inArray(memberTable.id, [memberId]));
  await appendEvent(source, {
    kind: "member.reinstated",
    subjectType: "member",
    subjectId: memberId,
    payload: { [CASCADE]: fromSponsorMemberId },
  });
  return true;
}

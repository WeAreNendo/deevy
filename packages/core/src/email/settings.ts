import { emailSender as emailSenderTable, type Db } from "@deevy/db";
import { openSecret, sealSecret } from "../secrets.ts";
import { senderKinds, type EmailSenders, type EmailSetup, type SenderKind } from "./port.ts";

/**
 * The sender in force (docs/plans/email-channel.md, slice 3): the one an
 * admin set under Settings › Email, else the environment's. Settings wins
 * while it is set, so an admin can fix a sender without a redeploy, and
 * clearing it falls back rather than leaving the instance mute.
 */

export interface InForceOptions {
  db: Db;
  workspaceId: string;
  /** What Settings' credentials are sealed with (`DEEVY_SECRET`). */
  socketSecret?: string;
  /** The environment's sender. */
  email?: EmailSetup | null;
}

export interface InForce {
  setup: EmailSetup | null;
  source: "settings" | "environment" | null;
  /** Why a sender set in Settings cannot be read, when it cannot. */
  problem: string | null;
}

export async function setupInForce({
  db,
  workspaceId,
  socketSecret,
  email,
}: InForceOptions): Promise<InForce> {
  const row = await db.query.emailSender.findFirst({ where: { workspaceId } });
  if (row) {
    if (!socketSecret) {
      return {
        setup: null,
        source: "settings",
        problem:
          "deevy can't open the key saved here: the server has no secret to unseal it with. Ask whoever runs deevy to set it, or set the sender in its environment.",
      };
    }
    try {
      const credentials = JSON.parse(await openSecret(socketSecret, row.credentials)) as Record<
        string,
        string
      >;
      return {
        setup: {
          sender: row.sender as SenderKind,
          from: row.from,
          config: row.config,
          credentials,
        },
        source: "settings",
        problem: null,
      };
    } catch {
      return {
        setup: null,
        source: "settings",
        problem:
          "deevy can't open the key saved here: the server's secret for saved keys changed since. Save the sender again.",
      };
    }
  }
  return email ? { setup: email, source: "environment", problem: null } : noneInForce;
}

const noneInForce: InForce = { setup: null, source: null, problem: null };

/** The senders an admin may choose here: what this runtime can run, the stub aside. */
export function availableSenders(emailSenders: EmailSenders = {}): SenderKind[] {
  return senderKinds.filter((kind) => kind !== "stub" && emailSenders[kind] !== undefined);
}

/** Writes an admin's choice, its credentials sealed. */
export async function saveSender(
  db: Db,
  {
    workspaceId,
    memberId,
    setup,
    socketSecret,
  }: { workspaceId: string; memberId: string; setup: EmailSetup; socketSecret: string },
): Promise<void> {
  const values = {
    sender: setup.sender,
    from: setup.from,
    config: setup.config,
    credentials: await sealSecret(socketSecret, JSON.stringify(setup.credentials)),
    updatedBy: memberId,
    updatedAt: new Date(),
  };
  await db
    .insert(emailSenderTable)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: emailSenderTable.workspaceId, set: values });
}

/**
 * What an operation that sends now passes to `sendNow`: the senders this
 * runtime can run, and the setup in force for the caller's Workspace.
 */
export async function senderOptionsFor(context: {
  db: Db;
  workspace: { id: string };
  socketSecret?: string;
  email?: EmailSetup | null;
  emailSenders?: EmailSenders;
}): Promise<{ emailSenders?: EmailSenders; email: EmailSetup | null }> {
  const inForce = await setupInForce({
    db: context.db,
    workspaceId: context.workspace.id,
    ...(context.socketSecret ? { socketSecret: context.socketSecret } : {}),
    ...(context.email ? { email: context.email } : {}),
  });
  return {
    ...(context.emailSenders ? { emailSenders: context.emailSenders } : {}),
    email: inForce.setup,
  };
}

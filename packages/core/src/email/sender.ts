import type { EmailSender, EmailSenders, EmailSetup } from "./port.ts";

/**
 * Which sender is in force (docs/plans/email-channel.md): the setup Settings ›
 * Email or the environment chose, built from the senders this runtime can run.
 */

export interface ResolveSenderOptions {
  /** The senders this runtime can run. */
  emailSenders?: EmailSenders;
  /** The sender in force: Settings › Email's, else the environment's. */
  email?: EmailSetup | null;
  fetch?: typeof fetch;
}

/** The sender in force, or why there is none, in words an admin can act on. */
export function resolveSender({
  emailSenders = {},
  email,
  fetch: fetchImpl = fetch,
}: ResolveSenderOptions): { sender: EmailSender; setup: EmailSetup } | { reason: string } {
  if (!email) return { reason: "No email sender is configured." };
  const factory = emailSenders[email.sender];
  if (!factory) {
    return { reason: `The ${email.sender} sender cannot run on this deployment.` };
  }
  try {
    return {
      sender: factory({ config: email.config, credentials: email.credentials, fetch: fetchImpl }),
      setup: email,
    };
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

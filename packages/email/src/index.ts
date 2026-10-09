/**
 * The email senders that speak HTTP, and so run on both deployments
 * (docs/plans/email-channel.md). SMTP and Cloudflare Email Service need what
 * only one runtime has and live in `@deevy/adapters`.
 *
 * An entry builds the registry once and hands it to `createApp` and to the
 * sweep; the core holds the port and never this package.
 */
import type { EmailSenders } from "@deevy/core/email";
import { createMailgunSender } from "./mailgun/index.ts";
import { createPostmarkSender } from "./postmark/index.ts";
import { createResendSender } from "./resend/index.ts";
import { createSendgridSender } from "./sendgrid/index.ts";
import { createSesSender } from "./ses/index.ts";
import { createStubSender } from "./stub/index.ts";

export { emailSetupFromEnv, readEmailEnv } from "./env.ts";
export { createMailgunSender } from "./mailgun/index.ts";
export { createPostmarkSender } from "./postmark/index.ts";
export { createResendSender } from "./resend/index.ts";
export { createSendgridSender } from "./sendgrid/index.ts";
export { createSesSender } from "./ses/index.ts";
export { clearStubOutbox, createStubSender, stubOutbox } from "./stub/index.ts";

export interface EmailSendersOptions {
  /** Whether this deployment may register the development stand-in. */
  devStub?: boolean;
}

export function emailSenders({ devStub = false }: EmailSendersOptions = {}): EmailSenders {
  return {
    resend: createResendSender,
    postmark: createPostmarkSender,
    sendgrid: createSendgridSender,
    mailgun: createMailgunSender,
    ses: createSesSender,
    ...(devStub ? { stub: () => createStubSender() } : {}),
  };
}

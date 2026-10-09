import nodemailer from "nodemailer";

/**
 * Email over SMTP (docs/plans/email-channel.md, slice 5), for an operator who
 * already runs a mail server or a provider's SMTP relay. Node only: SMTP is raw
 * TCP and TLS, which the core may not import (ADR-0006) and a Worker does not
 * offer in any practical form.
 *
 * The shapes are restated rather than imported from `@deevy/core/email`, as
 * this package's other ports are (cron.ts): the core dev-depends on this
 * package, and `apps/server`, which hands this to the core, is where the
 * compiler checks they still match.
 */

export interface SmtpMessage {
  from: { address: string; name?: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export type SmtpResult =
  | { delivered: true; status: number; id?: string }
  | { delivered: false; retry: boolean; status: number; error: string };

export interface SmtpSenderInput {
  config: Record<string, string>;
  /** `url`: `smtps://user:pass@host:465`, or `smtp://…:587`, which upgrades with STARTTLS. */
  credentials: Record<string, string>;
}

/** The status at the start of an SMTP reply, `250 OK …`. */
function statusOf(reply: string | undefined): number {
  const code = Number(reply?.slice(0, 3));
  return Number.isFinite(code) && code > 0 ? code : 250;
}

export function createSmtpSender({ credentials }: SmtpSenderInput) {
  const url = credentials.url;
  if (!url) throw new Error("SMTP needs the server's URL.");
  if (!/^smtps?:\/\//i.test(url)) {
    throw new Error(
      "The SMTP URL must start with smtp:// or smtps://, such as smtps://user:pass@host:465.",
    );
  }
  const transport = nodemailer.createTransport({
    url,
    // A sweep is bounded; a server that will not answer is a retry, not a hang.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    kind: "smtp" as const,
    async send(message: SmtpMessage): Promise<SmtpResult> {
      try {
        const info = await transport.sendMail({
          from: message.from.name
            ? { name: message.from.name, address: message.from.address }
            : message.from.address,
          to: message.to,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        });
        return { delivered: true, status: statusOf(info.response), id: info.messageId };
      } catch (failure) {
        const error = failure as Error & { responseCode?: number; response?: string };
        const status = error.responseCode ?? 0;
        return {
          delivered: false,
          // A 5xx is the server saying no for good: a bad address, a refused
          // login, a sender it will not relay for. A 4xx, or no answer at
          // all, is worth another try.
          retry: !(status >= 500 && status < 600),
          status,
          error: (error.response ?? error.message).slice(0, 300),
        };
      }
    },
  };
}

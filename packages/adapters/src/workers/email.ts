/**
 * Cloudflare Email Service (docs/plans/email-channel.md, slice 5): the
 * Worker's `send_email` binding, whose `send()` takes the message's fields and
 * answers a `messageId`, or throws an Error with a `code`
 * (developers.cloudflare.com/email-service/api/send-emails/workers-api/).
 * Beta, and reaching any recipient needs the Workers Paid plan.
 *
 * The shapes are restated rather than imported from `@deevy/core/email`, as
 * this package's other ports are (queue.ts); `apps/web/src/worker.ts`, which
 * hands this to the core, is where the compiler checks they still match.
 */

export interface CloudflareEmailBinding {
  send(input: {
    to: string;
    from: { email: string; name?: string } | string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

export interface CloudflareMessage {
  from: { address: string; name?: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** What waiting can change: Cloudflare's rate limit, its own error, a receiving server that refused. */
const transient = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
  "E_DELIVERY_FAILED",
]);

export function createCloudflareSender(binding: CloudflareEmailBinding) {
  return {
    kind: "cloudflare" as const,
    async send(
      message: CloudflareMessage,
    ): Promise<
      | { delivered: true; status: number; id?: string }
      | { delivered: false; retry: boolean; status: number; error: string }
    > {
      // Cloudflare refuses a List-Unsubscribe that is not https, and with it
      // the whole email; an instance on plain http (local development) sends
      // without one, and its footer still links to Settings.
      const unsubscribe = message.headers["List-Unsubscribe"];
      const headers =
        unsubscribe !== undefined && !unsubscribe.includes("<https://")
          ? Object.fromEntries(
              Object.entries(message.headers).filter(
                ([name]) => !name.toLowerCase().startsWith("list-unsubscribe"),
              ),
            )
          : message.headers;
      try {
        const sent = await binding.send({
          to: message.to,
          from: message.from.name
            ? { email: message.from.address, name: message.from.name }
            : { email: message.from.address },
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        });
        return { delivered: true, status: 200, id: sent.messageId };
      } catch (failure) {
        const error = failure as Error & { code?: string };
        return {
          delivered: false,
          retry: error.code ? transient.has(error.code) : true,
          status: 0,
          error: (error.code ? `${error.code}: ${error.message}` : error.message).slice(0, 300),
        };
      }
    },
  };
}

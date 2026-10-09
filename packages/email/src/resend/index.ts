import {
  formatFrom,
  httpResult,
  unreachable,
  type EmailSender,
  type EmailSenderInput,
} from "@deevy/core/email";

/**
 * Resend (resend.com/docs/api-reference/emails/send-email): one POST with a
 * bearer key. It deduplicates on `Idempotency-Key` for a day, which is what
 * makes a retry after a timeout safe.
 */
export function createResendSender({ credentials, fetch }: EmailSenderInput): EmailSender {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("Resend needs an API key (RESEND_API_KEY).");
  const base = "https://api.resend.com";

  return {
    kind: "resend",
    async send(message) {
      try {
        const response = await fetch(`${base}/emails`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: formatFrom(message.from),
            to: [message.to],
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(Object.keys(message.headers).length > 0 ? { headers: message.headers } : {}),
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          id?: string;
          message?: string;
        } | null;
        return httpResult(
          response.status,
          body?.message ?? `Resend answered ${String(response.status)}`,
          body?.id,
        );
      } catch (failure) {
        return unreachable(failure);
      }
    },
  };
}

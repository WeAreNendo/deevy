import {
  defaultSendTimeoutMs,
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
export function createResendSender({
  credentials,
  fetch,
  timeoutMs = defaultSendTimeoutMs,
}: EmailSenderInput): EmailSender {
  const apiKey = credentials.apiKey;
  // Said without a variable's name: from Settings › Email there is none.
  if (!apiKey) throw new Error("Resend needs an API key.");
  const base = "https://api.resend.com";

  return {
    kind: "resend",
    async send(message) {
      try {
        const response = await fetch(`${base}/emails`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
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
          name?: string;
          message?: string;
        } | null;
        // The same key while the first request is still being handled: Resend
        // says to try again (resend.com/docs/dashboard/emails/idempotency-keys).
        if (response.status === 409 && body?.name === "concurrent_idempotent_requests") {
          return {
            delivered: false,
            retry: true,
            status: 409,
            error: body.message ?? "Resend is still handling this email",
          };
        }
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

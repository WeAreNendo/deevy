import {
  defaultSendTimeoutMs,
  httpResult,
  unreachable,
  type EmailSender,
  type EmailSenderInput,
} from "@deevy/core/email";

/**
 * SendGrid v3 Mail Send (twilio.com/docs/sendgrid/api-reference/mail-send):
 * one POST with a bearer key, answered 202 with the message's id in a header.
 * Plain text goes before HTML, as SendGrid requires when both are given.
 */
export function createSendgridSender({
  credentials,
  fetch,
  timeoutMs = defaultSendTimeoutMs,
}: EmailSenderInput): EmailSender {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("SendGrid needs an API key.");

  return {
    kind: "sendgrid",
    async send(message) {
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: message.to }] }],
            from: message.from.name
              ? { email: message.from.address, name: message.from.name }
              : { email: message.from.address },
            ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
            subject: message.subject,
            content: [
              { type: "text/plain", value: message.text },
              { type: "text/html", value: message.html },
            ],
            ...(Object.keys(message.headers).length > 0 ? { headers: message.headers } : {}),
          }),
        });
        const body = response.ok
          ? null
          : ((await response.json().catch(() => null)) as {
              errors?: Array<{ message?: string }>;
            } | null);
        return httpResult(
          response.status,
          body?.errors
            ?.map((one) => one.message)
            .filter(Boolean)
            .join(" ") || `SendGrid answered ${String(response.status)}`,
          response.headers.get("x-message-id") ?? undefined,
        );
      } catch (failure) {
        return unreachable(failure);
      }
    },
  };
}

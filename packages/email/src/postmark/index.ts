import {
  defaultSendTimeoutMs,
  formatFrom,
  httpResult,
  unreachable,
  type EmailSender,
  type EmailSenderInput,
} from "@deevy/core/email";

/**
 * Postmark (postmarkapp.com/developer/api/email-api): one POST with the
 * server token, on a message stream — `outbound`, the transactional one,
 * unless the operator named another.
 */
export function createPostmarkSender({
  config,
  credentials,
  fetch,
  timeoutMs = defaultSendTimeoutMs,
}: EmailSenderInput): EmailSender {
  const token = credentials.serverToken;
  if (!token) throw new Error("Postmark needs a server token.");
  const stream = config.messageStream || "outbound";

  return {
    kind: "postmark",
    async send(message) {
      try {
        const response = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-postmark-server-token": token,
          },
          body: JSON.stringify({
            From: formatFrom(message.from),
            To: message.to,
            ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
            Subject: message.subject,
            TextBody: message.text,
            HtmlBody: message.html,
            ...(Object.keys(message.headers).length > 0
              ? {
                  Headers: Object.entries(message.headers).map(([Name, Value]) => ({
                    Name,
                    Value,
                  })),
                }
              : {}),
            MessageStream: stream,
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          MessageID?: string;
          Message?: string;
        } | null;
        return httpResult(
          response.status,
          body?.Message ?? `Postmark answered ${String(response.status)}`,
          body?.MessageID,
        );
      } catch (failure) {
        return unreachable(failure);
      }
    },
  };
}

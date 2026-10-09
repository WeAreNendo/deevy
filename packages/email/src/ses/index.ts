import {
  defaultSendTimeoutMs,
  formatFrom,
  httpResult,
  unreachable,
  type EmailSender,
  type EmailSenderInput,
} from "@deevy/core/email";
import { signV4 } from "./sigv4.ts";

/**
 * Amazon SES v2 SendEmail
 * (docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html): a
 * simple message, signed for `ses` in the operator's region with an IAM key
 * that may `ses:SendEmail`. SES names a refusal in `x-amzn-ErrorType`, which
 * is said beside its message.
 */
export function createSesSender({
  config,
  credentials,
  fetch,
  timeoutMs = defaultSendTimeoutMs,
}: EmailSenderInput): EmailSender {
  const region = config.region;
  if (!region) throw new Error("Amazon SES needs its region.");
  // The region becomes the host the signed request goes to, so it must be one.
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
    throw new Error(`"${region}" isn't an AWS region, such as eu-west-1.`);
  }
  const { accessKeyId, secretAccessKey } = credentials;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Amazon SES needs an access key ID and its secret.");
  }
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

  return {
    kind: "ses",
    async send(message) {
      const body = JSON.stringify({
        FromEmailAddress: sesFrom(message.from),
        Destination: { ToAddresses: [message.to] },
        ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              Html: { Data: message.html, Charset: "UTF-8" },
            },
            ...(Object.keys(message.headers).length > 0
              ? {
                  Headers: Object.entries(message.headers).map(([Name, Value]) => ({
                    Name,
                    Value,
                  })),
                }
              : {}),
          },
        },
      });
      try {
        const signed = await signV4({
          method: "POST",
          url,
          headers: { "content-type": "application/json" },
          body,
          region,
          service: "ses",
          accessKeyId,
          secretAccessKey,
          ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
        });
        const response = await fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { ...signed.headers, authorization: signed.authorization },
          body,
        });
        const answer = (await response.json().catch(() => null)) as {
          MessageId?: string;
          message?: string;
          Message?: string;
        } | null;
        const type = response.headers.get("x-amzn-errortype")?.split(":")[0];
        const said =
          answer?.message ?? answer?.Message ?? `SES answered ${String(response.status)}`;
        return httpResult(response.status, type ? `${type}: ${said}` : said, answer?.MessageId);
      } catch (failure) {
        return unreachable(failure);
      }
    },
  };
}

/**
 * SES takes the From as one header value, and a display name outside ASCII
 * has to be RFC 2047-encoded there or the send is refused.
 */
function sesFrom(from: { address: string; name?: string }): string {
  if (!from.name || /^[\x20-\x7e]*$/.test(from.name)) return formatFrom(from);
  const bytes = new TextEncoder().encode(from.name);
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?= <${from.address}>`;
}

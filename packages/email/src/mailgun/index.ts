import {
  defaultSendTimeoutMs,
  formatFrom,
  httpResult,
  unreachable,
  type EmailSender,
  type EmailSenderInput,
} from "@deevy/core/email";

/**
 * Mailgun (documentation.mailgun.com, Messages › Send an email): a form POST
 * to the sending domain with basic auth as `api`, and every extra header as an
 * `h:` field. An EU domain lives on Mailgun's EU host.
 */
export function createMailgunSender({
  config,
  credentials,
  fetch,
  timeoutMs = defaultSendTimeoutMs,
}: EmailSenderInput): EmailSender {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("Mailgun needs an API key.");
  const domain = config.domain;
  if (!domain) throw new Error("Mailgun needs its sending domain.");
  const host = config.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";

  return {
    kind: "mailgun",
    async send(message) {
      const form = new URLSearchParams({
        from: formatFrom(message.from),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (message.replyTo) form.set("h:Reply-To", message.replyTo);
      for (const [name, value] of Object.entries(message.headers)) form.set(`h:${name}`, value);
      try {
        const response = await fetch(`${host}/v3/${encodeURIComponent(domain)}/messages`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization: `Basic ${btoa(`api:${apiKey}`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        const body = (await response.json().catch(() => null)) as {
          id?: string;
          message?: string;
        } | null;
        return httpResult(
          response.status,
          body?.message ?? `Mailgun answered ${String(response.status)}`,
          body?.id,
        );
      } catch (failure) {
        return unreachable(failure);
      }
    },
  };
}

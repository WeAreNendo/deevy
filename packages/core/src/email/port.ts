/**
 * Email, as the core needs it (docs/plans/email-channel.md).
 *
 * The types live here and the senders live elsewhere: the HTTP ones in
 * `@deevy/email`, SMTP in `@deevy/adapters/node`, Cloudflare Email Service in
 * `@deevy/adapters/workers`. An entry builds the registry of the senders its
 * runtime can run and hands it to `createApp({ emailSenders })` and to the
 * sweep, the way it hands over `sockets`, so the core never holds a provider's
 * client and the Workers build is what proves none of them leaks a `node:`
 * import into it.
 */

/** Every sender deevy knows. `stub` is the development stand-in, never a service. */
export const senderKinds = [
  "cloudflare",
  "resend",
  "postmark",
  "sendgrid",
  "mailgun",
  "ses",
  "smtp",
  "stub",
] as const;

export type SenderKind = (typeof senderKinds)[number];

/** One email, rendered and addressed. Both bodies, always: a client picks. */
export interface EmailMessage {
  from: { address: string; name?: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers: `List-Unsubscribe` and its `-Post`, a `Message-ID`. */
  headers: Record<string, string>;
  /**
   * The same for every attempt at one email — the delivery row's id — so a
   * service that deduplicates on it (Resend) does not send twice when an
   * attempt timed out after it had in fact landed.
   */
  idempotencyKey?: string;
}

/**
 * What one send came back with. A sender never throws: a refusal is an outcome
 * the sweep records. `retry` says whether waiting could change it — a timeout,
 * a 429, a 5xx — or not — a rejected address, a bad key, a From on a domain
 * the service has not verified — so a hopeless email is retired at once rather
 * than tried six times.
 */
export type SendResult =
  | { delivered: true; status: number; id?: string }
  | { delivered: false; retry: boolean; status: number; error: string };

export interface EmailSender {
  kind: SenderKind;
  send(message: EmailMessage): Promise<SendResult>;
}

/**
 * One sender, configured: which service, the From address, and what it needs.
 * `config` holds what is not secret (a region, a Mailgun domain, a Postmark
 * stream); `credentials` what is (an API key, an SMTP URL with its password).
 * Read from the environment by an entry, or from Settings › Email.
 */
export interface EmailSetup {
  sender: SenderKind;
  /** `deevy <deevy@example.com>` or a bare address. */
  from: string;
  config: Record<string, string>;
  credentials: Record<string, string>;
}

export interface EmailSenderInput {
  config: Record<string, string>;
  credentials: Record<string, string>;
  /** The way out. A test passes its own and never reaches the network. */
  fetch: typeof fetch;
}

/** Builds a sender from its setup, or throws when the setup cannot work. */
export type EmailSenderFactory = (input: EmailSenderInput) => EmailSender;

/** The senders this runtime can run. One it cannot is simply absent. */
export type EmailSenders = Partial<Record<SenderKind, EmailSenderFactory>>;

/** `deevy <deevy@example.com>` → its parts; a bare address is its own address. */
export function parseFrom(from: string): EmailMessage["from"] {
  const named = /^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(from);
  if (named) {
    const name = named[1]?.replace(/^"(.*)"$/, "$1").trim();
    return name ? { address: named[2] ?? "", name } : { address: named[2] ?? "" };
  }
  return { address: from.trim() };
}

/** The `From` header a service that takes one string wants. */
export function formatFrom({ address, name }: EmailMessage["from"]): string {
  return name ? `${JSON.stringify(name)} <${address}>` : address;
}

/** An HTTP status as a SendResult, with the service's own words when it refused. */
export function httpResult(status: number, error: string, id?: string): SendResult {
  if (status >= 200 && status < 300)
    return id ? { delivered: true, status, id } : { delivered: true, status };
  return {
    delivered: false,
    // A 408 or a 429 is the service asking for time; a 5xx is the service.
    // Every other 4xx is about the email or the key, and waiting changes neither.
    retry: status === 408 || status === 429 || status >= 500,
    status,
    error: error.slice(0, 300),
  };
}

/** A request that never got an answer: the network, a timeout. Always worth another try. */
export function unreachable(failure: unknown): SendResult {
  return {
    delivered: false,
    retry: true,
    status: 0,
    error: failure instanceof Error ? failure.message : "the request did not complete",
  };
}

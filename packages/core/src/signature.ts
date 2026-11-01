/**
 * How deevy signs what it sends, and how a sender signs what it sends deevy.
 *
 * One scheme in both directions: a webhook deevy posts to a subscribed URL
 * (webhooks.ts), and a delivery a tool's adapter posts to the generic Socket
 * (`@deevy/sockets`, src/generic). It is plain HMAC-SHA256 over the timestamp
 * and the body, so a receiver can verify it and a sender can make it in ten
 * lines in any language, with no SDK, and one routine in an n8n flow does both.
 *
 * Web-standard only (ADR-0006): `crypto.subtle`, never `node:crypto`.
 */

/** How long a signed body stays acceptable, so a captured POST cannot be replayed later. */
export const replayWindowSeconds = 5 * 60;

/** HMAC-SHA256 over `<unix seconds>.<body>`, which is what the header commits to. */
async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The `deevy-signature` header for one body: `t=<unix seconds>,v1=<hex>`.
 *
 * The timestamp is inside the signed message rather than beside it, so it
 * cannot be moved forward to keep an old body alive.
 */
export async function signPayload(secret: string, timestamp: Date, body: string): Promise<string> {
  const seconds = Math.floor(timestamp.getTime() / 1000);
  return `t=${seconds},v1=${await hmac(secret, `${seconds}.${body}`)}`;
}

export interface VerifyInput {
  /** The subscription's secret, which only deevy and the receiver hold. */
  secret: string;
  /** The `deevy-signature` header as it arrived. */
  header: string;
  /** The raw body, exactly as it was read off the wire. */
  body: string;
  /** The receiver's clock. */
  now?: Date;
  /** How old a signature may be. Beyond it, the POST is a replay. */
  toleranceSeconds?: number;
}

/**
 * What a receiver does with the header, written here because deevy has to be
 * able to say what "verifies" means and because a reference implementation
 * belongs beside the signer.
 *
 * It never throws: a malformed header is a refusal like any other.
 */
export async function verifySignature({
  secret,
  header,
  body,
  now = new Date(),
  toleranceSeconds = replayWindowSeconds,
}: VerifyInput): Promise<boolean> {
  const parts = new Map(
    header
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key as string, value as string]),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!signature || !Number.isFinite(timestamp)) return false;

  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  return equal(signature, await hmac(secret, `${timestamp}.${body}`));
}

/**
 * Compares in time that does not depend on where the two differ, so a receiver
 * cannot be walked to the right signature one byte at a time.
 */
function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let at = 0; at < left.length; at += 1) {
    difference |= left.charCodeAt(at) ^ right.charCodeAt(at);
  }
  return difference === 0;
}

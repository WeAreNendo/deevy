import { ORPCError } from "@orpc/server";

/**
 * What a credential is wrapped in at rest (ADR-0024).
 *
 * A Socket holds a real credential — a GitHub App's private key, a Linear
 * token, the secret a provider signs its deliveries with — and the database is
 * a file on a volume or a D1 database somebody can read. So the column holds an
 * envelope and nothing else: AES-256-GCM, the key derived from the instance's
 * own sealing secret, the whole of it web-standard so the same code runs on
 * Node and on a Worker (ADR-0006).
 *
 * The sealing secret is deliberately not Better Auth's: rotating that one
 * invalidates sessions, which an operator may do on a Tuesday, and it must not
 * also mean every connected tool has to be reconnected. Losing this one does
 * mean exactly that, which is why OPERATIONS.md says to back it up beside the
 * volume.
 */

/** Bound into the key derivation, so a later scheme is a new string and not a migration. */
export const SEALING_INFO = "deevy:socket-credentials:v1";

/** The envelope's version, which is its first field: `v1.<iv>.<ciphertext>`. */
const VERSION = "v1";

/** AES-GCM's nonce. Twelve bytes is the size the algorithm is fastest and safest at. */
const IV_BYTES = 12;

/** A 256-bit key wants at least as many bits of secret behind it. */
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The secret this deployment seals with, or the refusal that says it has none.
 *
 * Checked at the door of every operation that would write a credential, so an
 * instance without one refuses to connect a tool rather than storing a
 * plaintext credential and telling nobody.
 */
export function requireSealingSecret(secret: string | undefined): string {
  if (!secret || secret.trim().length === 0) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message:
        "This deevy has no secret to seal a credential with, so it cannot connect a tool. Set one on the server and restart.",
    });
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message: `The secret this deevy seals credentials with is shorter than ${String(MIN_SECRET_LENGTH)} characters, which is not enough to hold one.`,
    });
  }
  return secret;
}

async function keyFor(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    // No salt: HKDF's salt is optional and defaults to zeros, and there is
    // nowhere to keep a per-instance one that the envelope would not have to
    // carry. What separates this key from any other use of the same secret is
    // the info string.
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(SEALING_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Wraps one value. A fresh nonce every time, so two equal values seal differently. */
export async function sealSecret(secret: string, plaintext: string): Promise<string> {
  const key = await keyFor(requireSealingSecret(secret));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

/**
 * Unwraps one value, or throws.
 *
 * Every failure reads the same way on purpose: a changed key, a changed byte
 * and a shape deevy did not write are all "this cannot be opened", and none of
 * them says which, because the caller's next move is the same in each case —
 * reconnect the tool.
 */
export async function openSecret(secret: string, envelope: string): Promise<string> {
  const [version, iv, ciphertext] = envelope.split(".");
  if (version !== VERSION || !iv || !ciphertext) {
    throw new Error("deevy cannot open this credential: it is not an envelope deevy wrote");
  }
  const key = await keyFor(requireSealingSecret(secret));
  try {
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv) },
      key,
      fromBase64Url(ciphertext),
    );
    return decoder.decode(opened);
  } catch {
    throw new Error("deevy cannot open this credential: its secret changed, or the value did");
  }
}

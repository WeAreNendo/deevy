/**
 * Authenticating as a GitHub App (ADR-0024).
 *
 * An App proves it is itself with a JWT signed by the private key GitHub gave
 * the operator, and then trades that JWT for an installation token per
 * repository. Two awkward facts shape this file.
 *
 * GitHub hands out **PKCS#1** — a file that starts `BEGIN RSA PRIVATE KEY` —
 * and `crypto.subtle` imports **PKCS#8** and nothing else. So deevy wraps the
 * one into the other rather than asking somebody to run `openssl` on a
 * credential before they can paste it; the wrap is a fixed ASN.1 prefix around
 * the bytes, which is all PKCS#8 is for an RSA key.
 *
 * And everything here is web-standard, because this package is bundled into
 * the Worker as well as the image: no `node:crypto`, no `Buffer`.
 */

const encoder = new TextEncoder();

/** `-----BEGIN X-----\n<base64>\n-----END X-----` to its bytes. */
function derFrom(pem: string, label: string): Uint8Array<ArrayBuffer> | null {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`, "m").exec(
    pem,
  );
  if (!match?.[1]) return null;
  const binary = atob(match[1].replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * A DER length, in the one encoding ASN.1 allows for that number: short form
 * under 128, else the byte count followed by the bytes, big-endian.
 */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 | bytes.length, ...bytes];
}

/** `SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING <pkcs1> }`. */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  // 1.2.840.113549.1.1.1, and the NULL parameters RSA takes.
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const version = [0x02, 0x01, 0x00];
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...algorithm, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

/**
 * The PKCS#8 bytes of whatever key an operator pasted, or a refusal that says
 * what they pasted instead.
 */
export function pkcs8From(pem: string): Uint8Array<ArrayBuffer> {
  const pkcs8 = derFrom(pem, "PRIVATE KEY");
  if (pkcs8) return pkcs8;
  const pkcs1 = derFrom(pem, "RSA PRIVATE KEY");
  if (pkcs1) return wrapPkcs1(pkcs1);
  throw new Error(
    "That is not a private key. Paste the .pem file GitHub gave you when you made the App, whole.",
  );
}

/**
 * The signing key an App's JWT is made with. Imported once and reused.
 *
 * Asynchronous all the way down, refusal included: a caller awaits this, and a
 * bad paste that threw synchronously would land somewhere else entirely.
 */
export async function importAppKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8From(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** How long a JWT lives. GitHub allows ten minutes; nine is room for a slow clock. */
const JWT_SECONDS = 9 * 60;

/**
 * The App's own token: who it is, valid for a few minutes, signed with its key.
 *
 * `iat` is a minute behind on purpose. GitHub refuses a token issued in the
 * future, and a server whose clock is a few seconds ahead of theirs would
 * otherwise mint tokens that are refused for no reason anybody could see.
 */
export async function appJwt(key: CryptoKey, appId: string, now = new Date()): Promise<string> {
  const issued = Math.floor(now.getTime() / 1000) - 60;
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(
    encoder.encode(JSON.stringify({ iat: issued, exp: issued + JWT_SECONDS, iss: appId })),
  );
  const signed = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signed))}`;
}

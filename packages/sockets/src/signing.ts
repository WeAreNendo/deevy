/**
 * What every provider that signs its deliveries has in common: an HMAC-SHA256
 * over bytes deevy did not choose, compared without saying where it differed.
 *
 * Web-standard only (`crypto.subtle`), because this package is bundled into
 * the Cloudflare Worker as well as the image.
 */
const encoder = new TextEncoder();

/** HMAC-SHA256 of `message` under `secret`, as lowercase hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compared in time that does not depend on where they first differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differ = 0;
  for (let index = 0; index < a.length; index += 1)
    differ |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return differ === 0;
}

/**
 * HMAC-SHA256 of `message` under a raw key, as standard base64: what Standard
 * Webhooks signs with, which GitLab's signing token follows.
 */
export async function hmacBase64(key: Uint8Array<ArrayBuffer>, message: string): Promise<string> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message)));
  let binary = "";
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A Workspace's two secrets, derived and never stored (docs/plans/hosted.md,
 * "Secrets"): Better Auth's, which signs its sessions, and the one its Sockets'
 * credentials are sealed under (`DEEVY_SECRET`, packages/core/src/secrets.ts).
 *
 * HKDF from the platform's master secret and the Workspace's object key — the
 * key, never the slug, which is a URL and could one day change. Storing a
 * generated secret in the object instead would put the key beside what it
 * seals, in every backup of it; a derived one is in no backup, and can be
 * handed to a team that takes its Workspace home without exposing anyone
 * else's. The version in the salt is how the master rotates.
 */
export type SecretPurpose = "auth" | "seal";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function workspaceSecret(
  master: string,
  key: string,
  purpose: SecretPurpose,
): Promise<string> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(master), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("deevy-hosted-v1"),
      info: encoder.encode(`deevy:hosted:${purpose}:${key}`),
    },
    material,
    256,
  );
  return base64url(new Uint8Array(bits));
}

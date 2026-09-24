import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { appJwt, importAppKey, pkcs8From } from "../src/github/keys.ts";

/**
 * A GitHub App authenticates as itself with a JWT it signs (ADR-0024).
 *
 * The awkward part is the key: GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE
 * KEY") and `crypto.subtle` imports PKCS#8 and nothing else, so deevy wraps it
 * rather than asking an operator to convert a file with openssl. These tests
 * make a real key pair, wrap it, and check that what comes out signs something
 * the matching public key verifies — which is the only way to know the wrap is
 * right rather than merely plausible.
 */
function keyPair(type: "pkcs1" | "pkcs8") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: type === "pkcs1" ? "pkcs1" : "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey, publicKey };
}

async function verifies(publicKeyPem: string, token: string): Promise<boolean> {
  const spki = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  const key = await crypto.subtle.importKey(
    "spki",
    new Uint8Array(spki),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const [header, payload, signature] = token.split(".");
  const bytes = Uint8Array.from(
    atob((signature ?? "").replace(/-/g, "+").replace(/_/g, "/")),
    (character) => character.charCodeAt(0),
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytes,
    new TextEncoder().encode(`${header ?? ""}.${payload ?? ""}`),
  );
}

describe("the key GitHub hands an operator", () => {
  it("is PKCS#1, and deevy wraps it into what crypto.subtle takes", async () => {
    const { privateKey, publicKey } = keyPair("pkcs1");
    expect(privateKey).toContain("BEGIN RSA PRIVATE KEY");

    const key = await importAppKey(privateKey);
    const token = await appJwt(key, "123456", new Date("2026-09-21T10:00:00Z"));

    expect(await verifies(publicKey, token)).toBe(true);
  });

  it("takes a PKCS#8 one as it stands, for an operator who converted it already", async () => {
    const { privateKey, publicKey } = keyPair("pkcs8");
    expect(privateKey).toContain("BEGIN PRIVATE KEY");

    const token = await appJwt(await importAppKey(privateKey), "123456", new Date());

    expect(await verifies(publicKey, token)).toBe(true);
  });

  it("says what is wrong with something that is not a key at all", async () => {
    await expect(
      importAppKey("-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----"),
    ).rejects.toThrow(/private key/i);
    await expect(importAppKey("just some text")).rejects.toThrow(/private key/i);
  });

  it("wraps only what needs wrapping", () => {
    const { privateKey } = keyPair("pkcs8");
    // Already PKCS#8: the bytes come back untouched, so nothing double-wraps.
    expect(pkcs8From(privateKey)).toEqual(pkcs8From(privateKey));
  });
});

describe("the JWT it signs", () => {
  it("says who it is and expires inside GitHub's ten minutes", async () => {
    const { privateKey } = keyPair("pkcs1");
    const now = new Date("2026-09-21T10:00:00Z");

    const token = await appJwt(await importAppKey(privateKey), "123456", now);

    const [header, payload] = token.split(".");
    const read = (part: string) =>
      JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    expect(read(header ?? "")).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = read(payload ?? "") as { iat: number; exp: number; iss: string };
    expect(claims.iss).toBe("123456");
    // A minute behind, because GitHub refuses a token from the future and a
    // server's clock is never quite the same as theirs.
    expect(claims.iat).toBe(Math.floor(now.getTime() / 1000) - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });
});

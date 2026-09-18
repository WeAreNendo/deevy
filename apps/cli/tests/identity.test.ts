import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PATH } from "@deevy/core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  credentialFor,
  fileNameFor,
  forgetToken,
  readToken,
  writeToken,
} from "../src/credentials.ts";
import { authorizeUrl, discover, exchange, listen, pkce, register } from "../src/login.ts";
import { whoAmI, type Reporter } from "../src/identity.ts";
import { baseURL, consent, cookieHeaders, humanMember, testDeevy } from "./helpers.ts";

const scratch: string[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-cli-"));
  scratch.push(dir);
  return dir;
}

/** Everything the CLI said, so a test reads what a person would see. */
function collect(): Reporter & { lines: { out: string[]; err: string[] } } {
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    lines,
    out: (line: string) => lines.out.push(line),
    err: (line: string) => lines.err.push(line),
  };
}

describe("where a token is kept", () => {
  it("is one file per instance, so signing into a second does not sign out the first", () => {
    expect(fileNameFor("https://deevy.example.com")).toBe("deevy.example.com.json");
    // A port is part of which instance this is, and a colon is not a file name.
    expect(fileNameFor("http://localhost:3000")).toBe("localhost_3000.json");
  });

  it("writes it where only this user can read it", async () => {
    const dir = await tempDir();
    const path = await writeToken(
      baseURL,
      { accessToken: "t", expiresAt: null, resource: `${baseURL}${API_PATH}` },
      dir,
    );
    // It is a bearer token: the care an SSH key gets, for the same reason.
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, "utf8")) as { accessToken: string }).toMatchObject({
      accessToken: "t",
    });
  });

  it("forgets it, and says whether there was one", async () => {
    const dir = await tempDir();
    expect(await forgetToken(baseURL, dir)).toBe(false);
    await writeToken(baseURL, { accessToken: "t", expiresAt: null, resource: "r" }, dir);
    expect(await forgetToken(baseURL, dir)).toBe(true);
    expect(await readToken(baseURL, dir)).toBeNull();
  });

  it("treats a file somebody edited by hand as signed out, not as a crash", async () => {
    const dir = await tempDir();
    await writeToken(baseURL, { accessToken: "t", expiresAt: null, resource: "r" }, dir);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, fileNameFor(baseURL)), "{ not json");
    expect(await readToken(baseURL, dir)).toBeNull();
  });
});

describe("which credential the CLI uses", () => {
  it("prefers the key in the environment, and says it is one", async () => {
    const dir = await tempDir();
    await writeToken(baseURL, { accessToken: "stored", expiresAt: null, resource: "r" }, dir);
    const credential = await credentialFor(baseURL, { DEEVY_API_KEY: "deevy_sk_x" }, dir);
    // An Agent's key is the explicit thing somebody put there for this one run,
    // and it changes what the CLI may do — so it wins and it is named.
    expect(credential).toMatchObject({ kind: "key", token: "deevy_sk_x" });
  });

  it("falls back to the stored token", async () => {
    const dir = await tempDir();
    await writeToken(baseURL, { accessToken: "stored", expiresAt: null, resource: "r" }, dir);
    expect(await credentialFor(baseURL, {}, dir)).toMatchObject({
      kind: "token",
      token: "stored",
    });
  });

  it("is nobody when there is neither", async () => {
    expect(await credentialFor(baseURL, {}, await tempDir())).toBeNull();
  });
});

describe("the loopback listener", () => {
  it("takes the code, and refuses a callback carrying somebody else's state", async () => {
    const loopback = await listen("the-state");
    closers.push(loopback.close);
    const refused = await fetch(`${loopback.redirectUri}?code=c&state=not-the-state`);
    expect(refused.status).toBe(400);
    await expect(loopback.code).rejects.toThrow(/wrong state/);
  });

  it("carries an error back rather than hanging", async () => {
    const loopback = await listen("s");
    closers.push(loopback.close);
    await fetch(`${loopback.redirectUri}?error=access_denied&state=s`);
    await expect(loopback.code).rejects.toThrow(/access_denied/);
  });
});

describe("signing in to a real deevy", () => {
  /**
   * The whole dance against a real authorization server: discover, register
   * naming the API resource, authorize with PKCE, consent as the Human, and
   * exchange. Only the browser is stood in for — the CLI would open one, and
   * this follows the redirect itself.
   */
  it("gets a token the API accepts, and me.get then says who it is", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await humanMember(deevy.db);

    const metadata = await discover(baseURL, deevy.fetch);
    expect(metadata.issuer).toBe(baseURL);

    const loopback = await listen("s");
    closers.push(loopback.close);
    const clientId = await register(metadata, baseURL, loopback.redirectUri, deevy.fetch);
    const { verifier, challenge } = pkce();
    const resource = `${baseURL}${API_PATH}`;
    const url = authorizeUrl(metadata, {
      clientId,
      redirectUri: loopback.redirectUri,
      challenge,
      state: "s",
      resource,
    });

    // The browser's part: arrive at the authorize endpoint signed in, and take
    // the consent that follows.
    const cookie = await cookieHeaders(deevy.auth, "u1");
    const redirected = await deevy.fetch(url, { headers: cookie, redirect: "manual" });
    const code = await consent(deevy, cookie, redirected.headers.get("location") ?? "");
    const token = await exchange(
      metadata,
      { code, clientId, verifier, redirectUri: loopback.redirectUri, resource },
      deevy.fetch,
    );
    expect(token.accessToken).toBeTruthy();
    expect(token.resource).toBe(resource);

    const dir = await tempDir();
    await writeToken(baseURL, token, dir);
    const said = collect();
    const identity = await whoAmI(baseURL, { report: said, fetchImpl: deevy.fetch, dir });
    expect(identity).toMatchObject({ authenticatedAs: "human", via: "token", handle: "ada" });
    expect(said.lines.out.join("\n")).toContain("ada");
  });
});

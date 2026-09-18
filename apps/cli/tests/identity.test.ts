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
import { signIn, signOut, whoAmI, type Reporter } from "../src/identity.ts";
import { explain } from "../src/client.ts";
import { originFrom } from "../src/main.ts";
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
    expect(fileNameFor("https://deevy.example.com")).toBe("https_deevy.example.com.json");
    // A port is part of which instance this is, and a colon is not a file name.
    expect(fileNameFor("http://localhost:3000")).toBe("http_localhost_3000.json");
  });

  it("counts the scheme, because http and https on one host are two instances", () => {
    // The direct port and the same port behind a TLS proxy. Sharing a file
    // would hand a token minted for one origin to the other.
    expect(fileNameFor("http://host.example.com")).not.toBe(
      fileNameFor("https://host.example.com"),
    );
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

describe("signing in, as the command does it", () => {
  /**
   * `signIn` itself, rather than its parts reassembled: that it registers,
   * opens the right URL, takes the code, writes the file and closes the
   * listener. The browser is the only stand-in — `openBrowser: false` prints
   * the URL, and this follows it.
   */
  it("completes the flow and leaves a token only this user can read", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await tempDir();
    const said = collect();

    const signingIn = signIn(baseURL, {
      openBrowser: false,
      report: said,
      fetchImpl: deevy.fetch,
      dir,
    });

    // The Human's half, driven from the URL the CLI printed.
    const url = await waitFor(
      () => /https?:\/\/\S+oauth2\/authorize\S*/.exec(said.lines.err.join("\n"))?.[0],
    );
    const cookie = await cookieHeaders(deevy.auth, "u1");
    const redirected = await deevy.fetch(url, { headers: cookie, redirect: "manual" });
    const code = await consent(deevy, cookie, redirected.headers.get("location") ?? "");
    await fetch(
      `${new URL(url).searchParams.get("redirect_uri") ?? ""}?code=${code}&state=${new URL(url).searchParams.get("state") ?? ""}`,
    );

    await signingIn;
    const stored = await readToken(baseURL, dir);
    expect(stored?.accessToken).toBeTruthy();
    // No refresh token is asked for or kept: nothing refreshes, and one at rest
    // is a larger thing to lose for no benefit.
    expect(stored).not.toHaveProperty("refreshToken");
    expect((await stat(join(dir, fileNameFor(baseURL)))).mode & 0o777).toBe(0o600);
  });

  it("gives up rather than waiting for a redirect that is not coming", async () => {
    const loopback = await listen("s", 25);
    closers.push(loopback.close);
    await expect(loopback.code).rejects.toThrow(/not completed in time/);
  });

  it("keeps waiting when something else on this machine probes the callback", async () => {
    const loopback = await listen("the-state");
    closers.push(loopback.close);
    // A scanner, or a browser asking for a favicon: answered and ignored, so
    // the real redirect still arrives.
    expect((await fetch(`${loopback.redirectUri}?code=c&state=wrong`)).status).toBe(400);
    await fetch(`${loopback.redirectUri}?code=the-code&state=the-state`);
    expect(await loopback.code).toBe("the-code");
  });
});

describe("signing out", () => {
  it("forgets the token and says what it did", async () => {
    const dir = await tempDir();
    await writeToken(baseURL, { accessToken: "t", expiresAt: null, resource: "r" }, dir);
    const said = collect();
    await signOut(baseURL, { report: said, dir });
    expect(await readToken(baseURL, dir)).toBeNull();
    // The consent outlives the file, and only deevy's own UI can revoke it.
    expect(said.lines.err.join("\n")).toContain("still listed in deevy");
  });
});

describe("what a refusal is explained as", () => {
  it("names the key when a key is what is being refused", () => {
    const asAgent = { kind: "key", token: "k", origin: baseURL } as const;
    expect(explain({ code: "FORBIDDEN", message: "An Agent cannot do that" }, asAgent)).toContain(
      "DEEVY_API_KEY",
    );
    expect(explain({ code: "UNAUTHORIZED" }, asAgent)).toContain("DEEVY_API_KEY");
  });

  it("tells a signed-in Human to sign in again", () => {
    const asHuman = { kind: "token", token: "t", origin: baseURL, expiresAt: null } as const;
    expect(explain({ code: "UNAUTHORIZED" }, asHuman)).toContain("deevy login");
  });

  it("never puts the credential in the message", () => {
    const asAgent = { kind: "key", token: "deevy_sk_secret", origin: baseURL } as const;
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"]) {
      expect(explain({ code, message: "no" }, asAgent)).not.toContain("deevy_sk_secret");
    }
  });
});

describe("which instance was named", () => {
  it("takes the argument, then DEEVY_URL", () => {
    expect(originFrom("https://a.example.com", {})).toBe("https://a.example.com");
    expect(originFrom(undefined, { DEEVY_URL: "https://b.example.com" })).toBe(
      "https://b.example.com",
    );
    expect(() => originFrom(undefined, {})).toThrow(/No deevy named/);
  });

  it("assumes https, except on loopback, where deevy's own dev instance is http", () => {
    expect(originFrom("deevy.example.com", {})).toBe("https://deevy.example.com");
    expect(originFrom("localhost:3000", {})).toBe("http://localhost:3000");
    expect(originFrom("127.0.0.1:3000", {})).toBe("http://127.0.0.1:3000");
  });

  it("drops a trailing slash, which would double the one in /rpc", () => {
    expect(originFrom("https://deevy.example.com/", {})).toBe("https://deevy.example.com");
  });
});

/** Polls until the CLI has printed what the Human's browser would have opened. */
async function waitFor(look: () => string | undefined): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const found = look();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the CLI never printed an authorize URL");
}

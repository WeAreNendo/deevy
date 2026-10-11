import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { credentialFor, fileNameFor, readToken, writeToken } from "../src/credentials.ts";
import { gateUrl } from "../src/gates.ts";
import { addGeneratedCommands } from "../src/generate.ts";
import { signIn, whoAmI } from "../src/identity.ts";
import { discover, metadataURLs } from "../src/login.ts";
import { webURLFrom } from "../src/main.ts";
import {
  apiToken,
  approveInBrowser,
  baseURL,
  collect,
  humanMember,
  recording,
  testDeevy,
} from "./helpers.ts";

/**
 * A deevy that lives under a path of its host (ADR-0029): a hosted Workspace at
 * `app.deevy.dev/acme`, or a deevy an operator serves at `company.com/deevy`.
 * Everything it answers is under the path, so a CLI that kept only the origin
 * of what it was given would talk to the root of the host — somebody else's
 * deevy, or nobody's.
 */

const scratch: string[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-cli-path-"));
  scratch.push(dir);
  return dir;
}

/** The test deevy's host, and a Workspace under it. */
const acme = `${baseURL}/acme`;

/** Metadata that names an issuer, the way an authorization server describes itself. */
function describing(issuer: string): Response {
  return new Response(
    JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/api/auth/oauth2/authorize`,
      token_endpoint: `${issuer}/api/auth/oauth2/token`,
      registration_endpoint: `${issuer}/api/auth/oauth2/register`,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A host that answers some URLs and 404s the rest. */
function answering(routes: Record<string, () => Response>): {
  fetch: typeof fetch;
  urls: string[];
} {
  return recording(((input: Request | string | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response("not here", { status: 404 }));
  }) as typeof fetch);
}

describe("where a token for a deevy under a path is kept", () => {
  it("is a file of its own, apart from the root of the same host", () => {
    expect(fileNameFor("https://app.deevy.dev/acme")).toBe("https_app.deevy.dev%2Facme.json");
    expect(fileNameFor("https://company.example.com/tools/deevy")).toBe(
      "https_company.example.com%2Ftools%2Fdeevy.json",
    );
    // Two Workspaces on one host are two deevys, and so is the root beside them.
    const names = new Set(
      ["https://app.deevy.dev", "https://app.deevy.dev/acme", "https://app.deevy.dev/globex"].map(
        fileNameFor,
      ),
    );
    expect(names.size).toBe(3);
  });

  it("cannot be mistaken for a port, or for another path", () => {
    // A port gets an underscore and a path is escaped, so the two never meet.
    expect(fileNameFor("https://host.example.com/8443")).not.toBe(
      fileNameFor("https://host.example.com:8443"),
    );
    expect(fileNameFor("https://host.example.com/a/b")).not.toBe(
      fileNameFor("https://host.example.com/a_b"),
    );
  });

  it("is named as it always was when the URL has no path", () => {
    expect(fileNameFor("https://deevy.example.com")).toBe("https_deevy.example.com.json");
    expect(fileNameFor("http://localhost:3000")).toBe("http_localhost_3000.json");
  });

  it("still finds a token an older CLI stored, and only for the deevy it was for", async () => {
    const dir = await tempDir();
    // Named the way every CLI before this one named it — by the origin, written
    // out here rather than through fileNameFor, so this holds if that changes.
    await writeFile(
      join(dir, "https_deevy.example.com.json"),
      JSON.stringify({
        accessToken: "from-an-older-cli",
        expiresAt: null,
        resource: "https://deevy.example.com/api",
      }),
      { mode: 0o600 },
    );
    expect(await credentialFor("https://deevy.example.com", {}, dir)).toMatchObject({
      kind: "token",
      token: "from-an-older-cli",
    });
    // A Workspace under a path of that host is another deevy, and the token's
    // audience is not its API.
    expect(await credentialFor("https://deevy.example.com/acme", {}, dir)).toBeNull();
  });
});

describe("finding the authorization server", () => {
  it("asks where RFC 8414 puts it first, then the two places under the path", () => {
    expect(metadataURLs("https://app.deevy.dev/acme")).toEqual([
      "https://app.deevy.dev/.well-known/oauth-authorization-server/acme",
      "https://app.deevy.dev/acme/.well-known/oauth-authorization-server",
      "https://app.deevy.dev/acme/.well-known/openid-configuration",
    ]);
  });

  it("asks exactly what it always asked at the root of a host", () => {
    expect(metadataURLs("https://deevy.example.com")).toEqual([
      "https://deevy.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("falls back to the path when a proxy forwards nothing else to deevy", async () => {
    const host = answering({
      "https://app.deevy.dev/acme/.well-known/oauth-authorization-server": () =>
        describing("https://app.deevy.dev/acme"),
    });
    const metadata = await discover("https://app.deevy.dev/acme", host.fetch);
    expect(metadata.token_endpoint).toBe("https://app.deevy.dev/acme/api/auth/oauth2/token");
    expect(host.urls).toEqual([
      "https://app.deevy.dev/.well-known/oauth-authorization-server/acme",
      "https://app.deevy.dev/acme/.well-known/oauth-authorization-server",
    ]);
  });

  it("falls back to OpenID Connect's document as the last place", async () => {
    const host = answering({
      "https://app.deevy.dev/acme/.well-known/openid-configuration": () =>
        describing("https://app.deevy.dev/acme"),
    });
    expect((await discover("https://app.deevy.dev/acme", host.fetch)).issuer).toBe(
      "https://app.deevy.dev/acme",
    );
  });

  it("will not use a document about another issuer, and asks the next place", async () => {
    // A deevy at the root of the same host answering the path-inserted URL
    // about itself. RFC 8414 §3.3: that metadata must not be used.
    const host = answering({
      "https://app.deevy.dev/.well-known/oauth-authorization-server/acme": () =>
        describing("https://app.deevy.dev"),
      "https://app.deevy.dev/acme/.well-known/oauth-authorization-server": () =>
        describing("https://app.deevy.dev/acme"),
    });
    expect((await discover("https://app.deevy.dev/acme", host.fetch)).issuer).toBe(
      "https://app.deevy.dev/acme",
    );
  });

  it("names the issuer that answered when it is not the deevy it was pointed at", async () => {
    // A deevy reached by a name other than its own would mint a token for an
    // audience the CLI never asks for; this says so before the browser opens.
    const host = answering({
      "http://127.0.0.1:3000/.well-known/oauth-authorization-server": () =>
        describing("http://localhost:3000"),
    });
    await expect(discover("http://127.0.0.1:3000", host.fetch)).rejects.toThrow(
      "deevy login http://localhost:3000",
    );
  });

  it("reads an issuer written with a trailing slash as the same URL", async () => {
    const host = answering({
      "https://app.deevy.dev/.well-known/oauth-authorization-server/acme": () =>
        describing("https://app.deevy.dev/acme/"),
    });
    await expect(discover("https://app.deevy.dev/acme", host.fetch)).resolves.toBeTruthy();
  });

  it("says what it always said when nothing answers", async () => {
    const host = answering({});
    await expect(discover("https://app.deevy.dev/acme", host.fetch)).rejects.toThrow(
      /does not look like a deevy with sign-in configured/,
    );
  });

  it("finds a real deevy under a path where RFC 8414 says, at the first place it asks", async () => {
    const deevy = testDeevy({ baseURL: acme });
    closers.push(deevy.close);
    const asked = recording(deevy.fetch);
    const metadata = await discover(acme, asked.fetch);
    expect(metadata.issuer).toBe(acme);
    expect(metadata.authorization_endpoint).toBe(`${acme}/api/auth/oauth2/authorize`);
    expect(asked.urls).toEqual([`${baseURL}/.well-known/oauth-authorization-server/acme`]);
  });

  it("finds a real deevy at the root of its host exactly where it always did", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const asked = recording(deevy.fetch);
    expect((await discover(baseURL, asked.fetch)).issuer).toBe(baseURL);
    expect(asked.urls).toEqual([`${baseURL}/.well-known/oauth-authorization-server`]);
  });
});

describe("signing in to a real deevy under a path", () => {
  /**
   * `deevy login http://localhost:3000/acme`, the whole way: discovered at the
   * path-inserted URL, registered and authorized for the API under the path,
   * the token kept under the whole URL, and then spent there.
   */
  it("gets a token for the API under the path, keeps it there, and spends it there", async () => {
    const deevy = testDeevy({ baseURL: acme });
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await tempDir();
    const said = collect();
    const asked = recording(deevy.fetch);

    const signingIn = signIn(acme, {
      openBrowser: false,
      report: said,
      fetchImpl: asked.fetch,
      dir,
    });
    const printed = await approveInBrowser(deevy, () => said.lines.err.join("\n"), "u1");
    await signingIn;

    // RFC 8707: the token is asked for the API this deevy serves, under its path.
    expect(new URL(printed).searchParams.get("resource")).toBe(`${acme}/api`);
    expect(printed.startsWith(`${acme}/api/auth/oauth2/authorize?`)).toBe(true);
    expect(asked.urls).toEqual([
      `${baseURL}/.well-known/oauth-authorization-server/acme`,
      `${acme}/api/auth/oauth2/register`,
      `${acme}/api/auth/oauth2/token`,
    ]);
    expect(said.lines.err.join("\n")).toContain(`Signed in to ${acme}.`);

    // Kept under the whole URL, and not where the root of the host would look.
    const stored = await readToken(acme, dir);
    expect(stored?.resource).toBe(`${acme}/api`);
    expect(await readToken(baseURL, dir)).toBeNull();
    expect((await stat(join(dir, "http_localhost_3000%2Facme.json"))).mode & 0o777).toBe(0o600);
    const claims = JSON.parse(
      Buffer.from(stored?.accessToken.split(".")[1] ?? "", "base64url").toString(),
    ) as { iss: string; aud: string | string[] };
    expect(claims.iss).toBe(acme);
    expect([claims.aud].flat()).toContain(`${acme}/api`);

    // And spent under the path, where the API accepts it.
    const calls = recording(deevy.fetch);
    const identity = await whoAmI(acme, { report: collect(), fetchImpl: calls.fetch, dir });
    expect(identity).toMatchObject({
      url: acme,
      origin: baseURL,
      authenticatedAs: "human",
      via: "token",
      handle: "ada",
    });
    expect(calls.urls).toEqual([`${acme}/rpc/me/get`]);
  });
});

describe("a generated command against a real deevy under a path", () => {
  it("asks what the deevy can do, and calls it, under the path", async () => {
    const deevy = testDeevy({ baseURL: acme, version: "0.9.0" });
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await tempDir();
    await writeToken(acme, await apiToken(deevy, "u1"), dir);

    const asked = recording(deevy.fetch);
    const said: string[] = [];
    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      baseURL: acme,
      dir,
      environment: {},
      fetchImpl: asked.fetch,
      out: (line) => said.push(line),
    }));

    await root.parseAsync(["me", "get", "--json"], { from: "user" });
    expect(JSON.parse(said.at(-1) ?? "{}") as unknown).toMatchObject({
      member: { handle: "ada" },
    });
    expect(asked.urls).toEqual([`${acme}/api/spec.json`, `${acme}/rpc/me/get`]);
    // What it can do is cached beside the token, under the same whole URL.
    await expect(
      stat(join(dir, "http_localhost_3000%2Facme.capabilities.json")),
    ).resolves.toBeTruthy();
  });
});

describe("a Gate on a deevy under a path", () => {
  it("opens the ruling screen under the path", () => {
    expect(gateUrl("https://app.deevy.dev/acme", "gate_abc123def456")).toBe(
      "https://app.deevy.dev/acme/gates/gate_abc123def456",
    );
  });

  it("goes to the SPA the API names, or the one DEEVY_WEB_URL names, path and all", () => {
    expect(webURLFrom(undefined, "https://app.deevy.dev/acme", {})).toBe(
      "https://app.deevy.dev/acme",
    );
    expect(
      webURLFrom(undefined, "https://api.example.com/acme", {
        DEEVY_WEB_URL: "https://web.example.com/acme/",
      }),
    ).toBe("https://web.example.com/acme");
  });
});

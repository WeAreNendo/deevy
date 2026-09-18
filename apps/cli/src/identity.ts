/**
 * The three verbs that are not operations: signing in, signing out, and asking
 * who this terminal is.
 *
 * They are hand-written because there is nothing in the registry to generate
 * them from — `me.get` answers the last one, but a Human has to be somebody
 * before it can be called.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { API_PATH } from "@deevy/core";
import { clientFor, explain } from "./client.ts";
import { credentialFor, forgetToken, writeToken, type Credential } from "./credentials.ts";
import { authorizeUrl, discover, exchange, listen, pkce, register } from "./login.ts";

export interface Reporter {
  out: (line: string) => void;
  err: (line: string) => void;
}

const console_: Reporter = {
  out: (line) => {
    console.log(line);
  },
  err: (line) => {
    console.error(line);
  },
};

/** Best effort: a terminal on a server has no browser, and that is not an error. */
function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Nothing to do: the URL was printed too.
  }
}

export async function signIn(
  origin: string,
  options: {
    openBrowser?: boolean;
    report?: Reporter;
    fetchImpl?: typeof fetch;
    dir?: string;
  } = {},
): Promise<void> {
  const report = options.report ?? console_;
  const fetchImpl = options.fetchImpl ?? fetch;
  const metadata = await discover(origin, fetchImpl);
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const loopback = await listen(state);
  try {
    const clientId = await register(metadata, origin, loopback.redirectUri, fetchImpl);
    const resource = `${origin}${API_PATH}`;
    const url = authorizeUrl(metadata, {
      clientId,
      redirectUri: loopback.redirectUri,
      challenge,
      state,
      resource,
    });
    report.err(`Opening ${origin} to sign in. If nothing happens, go to:\n  ${url}`);
    if (options.openBrowser !== false) openInBrowser(url);

    const code = await loopback.code;
    const token = await exchange(
      metadata,
      { code, clientId, verifier, redirectUri: loopback.redirectUri, resource },
      fetchImpl,
    );
    const path = await writeToken(origin, token, options.dir);
    report.err(`Signed in to ${origin}. Token stored at ${path}.`);
  } finally {
    loopback.close();
  }
}

export async function signOut(
  origin: string,
  options: { report?: Reporter; dir?: string } = {},
): Promise<void> {
  const report = options.report ?? console_;
  const existed = await forgetToken(origin, options.dir);
  report.err(
    existed
      ? `Forgot the token for ${origin}. The consent is still listed in deevy until you revoke it there.`
      : `Nothing stored for ${origin}.`,
  );
}

/** What `whoami` answers with, and what `--json` prints verbatim. */
export interface Identity {
  origin: string;
  /** How this terminal is authenticated, which decides what it may do. */
  authenticatedAs: "human" | "agent" | "nobody";
  via: "token" | "key" | "none";
  memberId?: string;
  handle?: string;
  role?: string;
}

export async function whoAmI(
  origin: string,
  options: {
    json?: boolean;
    report?: Reporter;
    fetchImpl?: typeof fetch;
    /** Where tokens are kept; a test points it somewhere disposable. */
    dir?: string;
  } = {},
): Promise<Identity> {
  const report = options.report ?? console_;
  const credential = await credentialFor(origin, process.env, options.dir);
  if (!credential) {
    const identity: Identity = { origin, authenticatedAs: "nobody", via: "none" };
    say(
      identity,
      options.json === true,
      report,
      `Not signed in to ${origin}. Run \`deevy login\`.`,
    );
    return identity;
  }

  const client = clientFor(credential, options.fetchImpl ?? fetch);
  const me = await client.me.get({}).catch((error: unknown) => {
    throw new Error(explain(error, credential));
  });
  const member = (
    me as { member?: { id: string; handle: string; kind: string; role: string } | null }
  ).member;
  const identity: Identity = {
    origin,
    authenticatedAs: member?.kind === "agent" ? "agent" : member ? "human" : "nobody",
    via: credential.kind === "key" ? "key" : "token",
    ...(member ? { memberId: member.id, handle: member.handle, role: member.role } : {}),
  };
  say(identity, options.json === true, report, humanLine(identity, credential));
  return identity;
}

function humanLine(identity: Identity, credential: Credential): string {
  if (!identity.handle) {
    return `Authenticated to ${identity.origin}, but no Member there yet. An admin has to invite you, or the allowlist has to match.`;
  }
  const how =
    credential.kind === "key"
      ? "an Agent's API key, from DEEVY_API_KEY"
      : "a token from `deevy login`";
  return `${identity.handle} (${identity.role}) at ${identity.origin}, as ${identity.authenticatedAs}, via ${how}.`;
}

function say(identity: Identity, json: boolean, report: Reporter, line: string): void {
  if (json) report.out(JSON.stringify(identity, null, 2));
  else report.out(line);
}

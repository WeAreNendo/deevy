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

/**
 * Best effort: a terminal on a server has no browser, and that is not an error.
 *
 * The listener matters. `spawn` does not throw when the opener is missing — it
 * returns, then emits `error` a tick later, and an unhandled `error` event is
 * an uncaught exception that kills the process. That is every headless Linux
 * box without `xdg-open`, and every Windows run, since `start` is a shell
 * builtin rather than a program. The URL has already been printed by then, so
 * the CLI should be waiting for the callback, not dying.
 */
function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

export async function signIn(
  baseURL: string,
  options: {
    openBrowser?: boolean;
    report?: Reporter;
    fetchImpl?: typeof fetch;
    dir?: string;
  } = {},
): Promise<void> {
  const report = options.report ?? console_;
  const fetchImpl = options.fetchImpl ?? fetch;
  const metadata = await discover(baseURL, fetchImpl);
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const loopback = await listen(state);
  try {
    const clientId = await register(metadata, baseURL, loopback.redirectUri, fetchImpl);
    const resource = `${baseURL}${API_PATH}`;
    const url = authorizeUrl(metadata, {
      clientId,
      redirectUri: loopback.redirectUri,
      challenge,
      state,
      resource,
    });
    report.err(`Opening ${baseURL} to sign in. If nothing happens, go to:\n  ${url}`);
    if (options.openBrowser !== false) openInBrowser(url);

    const code = await loopback.code;
    const token = await exchange(
      metadata,
      { code, clientId, verifier, redirectUri: loopback.redirectUri, resource },
      fetchImpl,
    );
    const path = await writeToken(baseURL, token, options.dir);
    report.err(`Signed in to ${baseURL}. Token stored at ${path}.`);
  } finally {
    loopback.close();
  }
}

export async function signOut(
  baseURL: string,
  options: { report?: Reporter; dir?: string } = {},
): Promise<void> {
  const report = options.report ?? console_;
  const existed = await forgetToken(baseURL, options.dir);
  report.err(
    existed
      ? `Forgot the token for ${baseURL}. The consent is still listed in deevy until you revoke it there.`
      : `Nothing stored for ${baseURL}.`,
  );
}

/** What `whoami` answers with, and what `--json` prints verbatim. */
export interface Identity {
  /** The deevy that answered: its whole URL, path included. */
  url: string;
  /**
   * The origin of that URL, which is all an older CLI printed here. Kept for a
   * script that reads it; `url` is the one that names a deevy under a path.
   */
  origin: string;
  /**
   * Who this terminal is to deevy, which decides what it may do.
   *
   * `stranger` and `nobody` are different answers and were one for a review
   * round: a credential deevy accepts that belongs to no Member is not the same
   * as no credential at all, and only the first is fixed by an invitation.
   */
  authenticatedAs: "human" | "agent" | "stranger" | "nobody";
  via: "token" | "key" | "none";
  memberId?: string;
  handle?: string | null;
  role?: string;
  /** A suspended Member is refused everything, while looking like a Member. */
  suspended?: boolean;
}

export async function whoAmI(
  baseURL: string,
  options: {
    json?: boolean;
    report?: Reporter;
    fetchImpl?: typeof fetch;
    /** Where tokens are kept; a test points it somewhere disposable. */
    dir?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<Identity> {
  const report = options.report ?? console_;
  const where = { url: baseURL, origin: new URL(baseURL).origin };
  const credential = await credentialFor(baseURL, options.environment ?? process.env, options.dir);
  if (!credential) {
    const identity: Identity = { ...where, authenticatedAs: "nobody", via: "none" };
    say(
      identity,
      options.json === true,
      report,
      `Not signed in to ${baseURL}. Run \`deevy login\`.`,
    );
    return identity;
  }

  const client = clientFor(credential, options.fetchImpl ?? fetch);
  // Typed by the router, not cast: the cast this replaced declared a handle as
  // a string where the schema allows null, which hid a branch below.
  const me = await client.me.get({}).catch((error: unknown) => {
    throw new Error(explain(error, credential));
  });
  const member = me.member;
  const identity: Identity = {
    ...where,
    authenticatedAs: !member ? "stranger" : member.kind === "agent" ? "agent" : "human",
    via: credential.kind === "key" ? "key" : "token",
    ...(member
      ? {
          memberId: member.id,
          handle: member.handle,
          role: member.role,
          ...(member.suspendedAt ? { suspended: true } : {}),
        }
      : {}),
  };
  say(identity, options.json === true, report, humanLine(identity, credential));
  return identity;
}

function humanLine(identity: Identity, credential: Credential): string {
  if (identity.authenticatedAs === "stranger") {
    return `${identity.url} knows that credential, but it belongs to no Member there. An admin has to invite you, or the allowlist has to match.`;
  }
  const how =
    credential.kind === "key"
      ? "an Agent's API key, from DEEVY_API_KEY"
      : "a token from `deevy login`";
  const who = identity.handle ?? identity.memberId ?? "somebody";
  const line = `${who} (${identity.role ?? "member"}) at ${identity.url}, as ${identity.authenticatedAs}, via ${how}.`;
  // A suspended Member is refused every operation while looking like a Member,
  // so the fact belongs in the answer rather than in the first refusal.
  return identity.suspended
    ? `${line}\nThat Member is suspended, so deevy will refuse everything.`
    : line;
}

function say(identity: Identity, json: boolean, report: Reporter, line: string): void {
  if (json) report.out(JSON.stringify(identity, null, 2));
  else report.out(line);
}

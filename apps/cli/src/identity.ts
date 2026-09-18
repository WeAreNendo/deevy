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
 * The one thing a CLI can do about a Gate: put it in front of a Human.
 *
 * A Gate is ruled in deevy's own browser and by nothing else — not this, not an
 * API key, not an Agent, whatever it is signed in as (ADR-0004, ADR-0010) — so
 * the useful verb is not `approve` but `open`. The URL is the one deevy builds
 * for itself when it tells somebody about an Issue (packages/core/src/slack.ts).
 */
export function gateUrl(webOrigin: string, issueKey: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/issues/${encodeURIComponent(issueKey)}`;
}

export async function openGate(
  origin: string,
  issueKey: string,
  options: { openBrowser?: boolean; report?: Reporter } = {},
): Promise<string> {
  const report = options.report ?? console_;
  const url = gateUrl(origin, issueKey);
  report.err("A Gate is ruled in deevy, by a Human, in a browser.");
  report.out(url);
  if (options.openBrowser !== false) openInBrowser(url);
  return Promise.resolve(url);
}

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
  origin: string,
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
  const credential = await credentialFor(origin, options.environment ?? process.env, options.dir);
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
  // Typed by the router, not cast: the cast this replaced declared a handle as
  // a string where the schema allows null, which hid a branch below.
  const me = await client.me.get({}).catch((error: unknown) => {
    throw new Error(explain(error, credential));
  });
  const member = me.member;
  const identity: Identity = {
    origin,
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
    return `${identity.origin} knows that credential, but it belongs to no Member there. An admin has to invite you, or the allowlist has to match.`;
  }
  const how =
    credential.kind === "key"
      ? "an Agent's API key, from DEEVY_API_KEY"
      : "a token from `deevy login`";
  const who = identity.handle ?? identity.memberId ?? "somebody";
  const line = `${who} (${identity.role ?? "member"}) at ${identity.origin}, as ${identity.authenticatedAs}, via ${how}.`;
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

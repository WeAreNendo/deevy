/**
 * `deevy whoami`: which Agent this terminal is, at which deevy.
 *
 * Hand-written, though `me.get` answers it, because the answer worth giving
 * starts before the call: a terminal with no key is nobody, and saying how to
 * become somebody is the useful line.
 */
import { clientFor, explain } from "./client.ts";
import { credentialFor, noKey } from "./credentials.ts";

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
   * Who this terminal is to deevy. `stranger` is a key deevy accepts whose
   * Agent is no Member of the Workspace, which is not the same as no key.
   */
  authenticatedAs: "agent" | "stranger" | "nobody";
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
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<Identity> {
  const report = options.report ?? console_;
  const where = { url: baseURL, origin: new URL(baseURL).origin };
  const credential = credentialFor(baseURL, options.environment ?? process.env);
  if (!credential) {
    const identity: Identity = { ...where, authenticatedAs: "nobody" };
    say(identity, options.json === true, report, noKey(baseURL));
    return identity;
  }

  const client = clientFor(credential, options.fetchImpl ?? fetch);
  const me = await client.me.get({}).catch((error: unknown) => {
    throw new Error(explain(error));
  });
  const member = me.member;
  const identity: Identity = {
    ...where,
    authenticatedAs: member ? "agent" : "stranger",
    ...(member
      ? {
          memberId: member.id,
          handle: member.handle,
          role: member.role,
          ...(member.suspendedAt ? { suspended: true } : {}),
        }
      : {}),
  };
  say(identity, options.json === true, report, line(identity));
  return identity;
}

function line(identity: Identity): string {
  if (identity.authenticatedAs === "stranger") {
    return `${identity.url} knows that key, but its Agent is no Member there.`;
  }
  const who = identity.handle ?? identity.memberId ?? "an Agent";
  const said = `${who} at ${identity.url}, the Agent whose key is in DEEVY_API_KEY.`;
  // A suspended Member is refused every operation while looking like a Member,
  // so the fact belongs in the answer rather than in the first refusal.
  return identity.suspended
    ? `${said}\nThat Agent is suspended, so deevy will refuse everything.`
    : said;
}

function say(identity: Identity, json: boolean, report: Reporter, line: string): void {
  if (json) report.out(JSON.stringify(identity, null, 2));
  else report.out(line);
}

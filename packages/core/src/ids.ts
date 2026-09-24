/**
 * Every row deevy creates gets an id that says what it is (ADR-0015):
 * a short prefix, an underscore, and twelve characters from `0-9a-z` —
 * `iss_k3xr8v2m9qpw`. Readable in an Event payload, an MCP argument or a URL,
 * copy-pasteable, safe to say aloud; about 62 bits of randomness per id, from
 * the Web Crypto API so the same code runs on Node and on Workers. The Event
 * `seq`, an Issue's external key (`acme/deevy#42`) and API key secrets
 * (`deevy_sk_…`) are not ids of this kind and stay as they are.
 */
export const idPrefixes = {
  workspace: "ws",
  member: "mem",
  socket: "sock",
  inboundDelivery: "inb",
  project: "proj",
  issue: "iss",
  link: "lnk",
  run: "run",
  checkpoint: "chk",
  gateRequest: "gate",
  gateDecision: "dec",
  socketMirror: "mir",
  memberIdentity: "mid",
  activity: "act",
  notification: "ntf",
  webhook: "whk",
  delivery: "dlv",
  channel: "chan",
  routingRule: "rte",
  allowlistRule: "alw",
  invitation: "inv",
  // Better Auth's own models, through its generateId hook (auth.ts).
  user: "usr",
  session: "ses",
  account: "acct",
  verification: "ver",
  apikey: "key",
  jwks: "jwk",
  oauthClient: "oacl",
  oauthResource: "oars",
  oauthClientResource: "oacr",
  oauthAccessToken: "oaat",
  oauthRefreshToken: "oart",
  oauthConsent: "oacs",
  // Reserved, never minted: the oauth-provider plugin gives a client
  // assertion its own jti as the id, and Better Auth keeps that one.
  oauthClientAssertion: "oaca",
} as const;

export type IdKind = keyof typeof idPrefixes;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 12;

/** Twelve symbols from the 36-letter alphabet, without modulo bias. */
function randomBody(): string {
  let out = "";
  const bytes = new Uint8Array(ID_LENGTH * 2);
  while (out.length < ID_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 is the largest multiple of 36 below 256; above it the draw is redone.
      if (byte < 252 && out.length < ID_LENGTH) out += ALPHABET[byte % 36];
    }
  }
  return out;
}

export function newId(kind: IdKind): string {
  return `${idPrefixes[kind]}_${randomBody()}`;
}

/**
 * Better Auth's models by the names its `generateId` hook passes: the schema
 * keys, which are camelCase even where the table is snake_case. A model
 * missing here is refused rather than given a made-up prefix, because the
 * first row a new plugin writes is the moment to add its line, and an id
 * `isId` rejects would surface somewhere far less obvious.
 */
const authModels: Record<string, IdKind> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  apikey: "apikey",
  jwks: "jwks",
  oauthClient: "oauthClient",
  oauthResource: "oauthResource",
  oauthClientResource: "oauthClientResource",
  oauthAccessToken: "oauthAccessToken",
  oauthRefreshToken: "oauthRefreshToken",
  oauthConsent: "oauthConsent",
  oauthClientAssertion: "oauthClientAssertion",
};

export function authId(model: string): string {
  const kind = authModels[model];
  if (!kind) {
    throw new Error(
      `No id prefix for Better Auth model "${model}": add it to idPrefixes and authModels (ids.ts)`,
    );
  }
  return newId(kind);
}

/** Whether `value` is an id of `kind` (or of any kind, when none is given). */
export function isId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== "string") return false;
  const prefix = kind ? idPrefixes[kind] : "[a-z]{2,6}";
  return new RegExp(`^${prefix}_[0-9a-z]{${String(ID_LENGTH)}}$`).test(value);
}

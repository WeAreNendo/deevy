/**
 * Who the CLI acts as: the Agent whose key is in `DEEVY_API_KEY`.
 *
 * There is nobody else it could be. deevy mints no token for a Human to carry
 * out of the browser, and a key stands only for an Agent (ADR-0035), so a
 * terminal without one is nobody to deevy. The key is read from the
 * environment on every invocation rather than stored: whatever runs the Agent,
 * or whoever set the variable, already holds it.
 */

/** The key, and the deevy it is spent at. */
export interface Credential {
  token: string;
  baseURL: string;
}

export function credentialFor(
  baseURL: string,
  environment: NodeJS.ProcessEnv = process.env,
): Credential | null {
  const key = environment.DEEVY_API_KEY?.trim();
  return key ? { token: key, baseURL } : null;
}

/** What a command says when there is no key to spend. */
export function noKey(baseURL: string): string {
  return `No Agent's key for ${baseURL}. Set DEEVY_API_KEY to the key its Sponsor issued in deevy.`;
}

import type { EmailSetup, SenderKind } from "@deevy/core/email";

/**
 * The sender an environment configures (docs/plans/email-channel.md), read the
 * same way by the Node server and the Worker. Settings › Email may override it
 * per Workspace; this is what an operator sets before anybody signs in.
 */

type Env = Record<string, string | undefined>;

/** One variable a sender reads: where it goes, and whether it is a secret. */
interface Variable {
  name: string;
  key: string;
  secret: boolean;
  required: boolean;
}

/** What each sender reads, beside `DEEVY_EMAIL_FROM`. */
const variables: Partial<Record<SenderKind, Variable[]>> = {
  resend: [{ name: "RESEND_API_KEY", key: "apiKey", secret: true, required: true }],
};

/** What a development stand-in sends as, so it needs nothing set at all. */
const stubFrom = "deevy <deevy@example.com>";

export function emailSetupFromEnv(
  env: Env,
  { devStub = false }: { devStub?: boolean } = {},
): EmailSetup | null {
  const chosen = env.DEEVY_EMAIL_SENDER?.trim();
  if (!chosen) {
    return devStub ? { sender: "stub", from: stubFrom, config: {}, credentials: {} } : null;
  }
  const reads = variables[chosen as SenderKind];
  if (!reads) {
    throw new Error(
      `DEEVY_EMAIL_SENDER is "${chosen}", which deevy cannot send through. It can be one of: ${Object.keys(variables).join(", ")}.`,
    );
  }
  const from = env.DEEVY_EMAIL_FROM?.trim();
  const missing = [
    ...(from ? [] : ["DEEVY_EMAIL_FROM"]),
    ...reads.filter((one) => one.required && !env[one.name]?.trim()).map((one) => one.name),
  ];
  if (missing.length > 0) {
    throw new Error(`DEEVY_EMAIL_SENDER=${chosen} also needs ${missing.join(" and ")}.`);
  }
  const config: Record<string, string> = {};
  const credentials: Record<string, string> = {};
  for (const one of reads) {
    const value = env[one.name]?.trim();
    if (value) (one.secret ? credentials : config)[one.key] = value;
  }
  return { sender: chosen as SenderKind, from: from ?? "", config, credentials };
}

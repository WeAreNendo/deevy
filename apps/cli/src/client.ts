/**
 * deevy over RPC, typed by the router deevy itself defines.
 *
 * This is `apps/web/src/lib/orpc.ts` with two changes: the origin is whichever
 * instance the CLI was pointed at, and the credential is a bearer rather than a
 * cookie. Everything else — the wire format, the error codes, the types — is
 * the browser client's, because it is the same client (ADR-0005).
 */
import type { AppRouter } from "@deevy/core";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { Credential } from "./credentials.ts";
import { flagNameFor } from "./flags.ts";

export type DeevyClient = RouterClient<AppRouter>;

export function clientFor(credential: Credential, fetchImpl = fetch): DeevyClient {
  const link = new RPCLink({
    // `url` is the path and `origin` is what it hangs off — the browser client
    // needs only the first because a page already has the second.
    origin: credential.origin,
    url: "/rpc",
    headers: { authorization: `Bearer ${credential.token}` },
    fetch: (url, init) => fetchImpl(url, init),
  });
  return createORPCClient(link);
}

/**
 * What a refusal means, in words rather than in a code.
 *
 * oRPC answers a refusal as JSON carrying the code the handler threw, so the
 * CLI can say something better than the HTTP status — and for the two refusals
 * a CLI earns by being a CLI, it should: an Agent's key reaching an operation
 * only Humans may call, and any delegated credential reaching a Gate.
 */
export function explain(error: unknown, credential: Credential): string {
  const failure = error as {
    code?: string;
    message?: string;
    data?: { issues?: { path?: (string | number)[]; message?: string }[] };
  };
  const code = failure.code ?? "";
  const message = failure.message ?? String(error);

  // oRPC answers a validation failure with "Input validation failed" and puts
  // what actually went wrong in `data.issues`. Without this the CLI says less
  // than the browser does — and the decision not to coerce argv, which is what
  // keeps an Issue titled "42" a title, only pays off if zod's own complaint is
  // what arrives.
  const issues = failure.data?.issues ?? [];
  if (code === "BAD_REQUEST" && issues.length > 0) {
    return issues
      .map((issue) => {
        const field = issue.path?.[0];
        const where = typeof field === "string" ? `${flagNameFor(field)}: ` : "";
        return `${where}${issue.message ?? "is not what this operation accepts"}`;
      })
      .join("\n");
  }
  if (code === "UNAUTHORIZED") {
    return credential.kind === "key"
      ? "That key was refused. Check DEEVY_API_KEY, or unset it to use the Human you signed in as."
      : "Signed out, or the token has expired. Run `deevy login` again.";
  }
  if (code === "FORBIDDEN" && credential.kind === "key") {
    return `${message}\nThe CLI is acting as an Agent, because DEEVY_API_KEY is set. Unset it to act as yourself.`;
  }
  return message;
}

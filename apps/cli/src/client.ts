/**
 * deevy over RPC, typed by the router deevy itself defines.
 *
 * This is `apps/web/src/lib/orpc.ts` with two changes: the URL is whichever
 * instance the CLI was pointed at, and the credential is an Agent's key as a
 * bearer rather than a cookie. Everything else — the wire format, the error codes, the types — is
 * the browser client's, because it is the same client (ADR-0005).
 */
import { basePathOf, type AppRouter } from "@deevy/core";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { Credential } from "./credentials.ts";
import { flagNameFor } from "./flags.ts";

export type DeevyClient = RouterClient<AppRouter>;

export function clientFor(credential: Credential, fetchImpl = fetch): DeevyClient {
  const link = new RPCLink({
    // `url` is the path and `origin` is what it hangs off — the browser client
    // needs only the first because a page already has the second. The path is
    // the one the deevy lives under, then `/rpc`: the browser reads it off the
    // page's `<base href>`, and this off the URL it was given.
    origin: new URL(credential.baseURL).origin,
    url: `${basePathOf(credential.baseURL)}/rpc`,
    headers: { authorization: `Bearer ${credential.token}` },
    fetch: (url, init) => fetchImpl(url, init),
  });
  return createORPCClient(link);
}

/**
 * What a refusal means, in words rather than in a code.
 *
 * oRPC answers a refusal as JSON carrying the code the handler threw, so the
 * CLI can say something better than the HTTP status — and for the refusal a
 * CLI earns by being a CLI, a key deevy does not take, it should.
 */
export function explain(error: unknown): string {
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
    // A key stands only for an Agent (ADR-0035), so a Human's own key, a
    // revoked one and a typo are all refused the same way.
    return "That key was refused. DEEVY_API_KEY has to hold an Agent's key, as its Sponsor issued it in deevy.";
  }
  return message;
}

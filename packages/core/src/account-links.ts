import { ORPCError } from "@orpc/server";
import { linkConsentedAccount } from "./identities.ts";
import type { AppContext, ContextFor } from "./operations/registry.ts";
import { signState, verifyState } from "./secrets.ts";
import { socketModuleFor } from "./sockets/registry.ts";

/**
 * Linking an account on a tool deevy does not sign people in with, through
 * that tool's own consent page: Linear's (ADR-0025).
 *
 * `identities.begin` sends a signed-in Human to the tool with a `state`, the
 * tool asks them, and their browser comes back to
 * `/api/identities/:provider/callback` with a code. What the code answers —
 * which account consented, in which workspace — is the proof, and deevy keeps
 * no token of theirs. The `state` names the Socket and is signed for this
 * Human alone, so a callback somebody else's browser finishes links nothing:
 * there is no table, because nothing has to be remembered that the state
 * cannot carry.
 */

/** Where a tool sends a Human back to. The tool's OAuth app has to list it. */
export function accountCallbackUrl(context: Pick<AppContext, "baseURL">, provider: string): string {
  return `${(context.baseURL ?? "").replace(/\/+$/, "")}/api/identities/${provider}/callback`;
}

/** What a state is signed over: this Socket, for this Member. */
function signedFor(socketId: string, memberId: string): string {
  return `identity:${socketId}:${memberId}`;
}

export async function beginAccountLink(
  context: ContextFor<"member">,
  socketId: string,
): Promise<{ url: string }> {
  const socket = await context.db.query.socket.findFirst({
    where: { id: socketId, workspaceId: context.workspace.id },
  });
  if (!socket || socket.status !== "active") {
    throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
  }
  const module = await socketModuleFor(context, socket);
  if (!module.accountLink) {
    throw new ORPCError("NOT_FOUND", {
      message: `An account on ${socket.name} is not linked this way`,
    });
  }
  if (!context.secret) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message:
        "This deevy has no secret to sign a redirect with, so it cannot start that flow. Set one on the server and restart.",
    });
  }
  // A Socket id carries no dot, so the state reads back unambiguously.
  const state = `${socket.id}.${await signState(context.secret, signedFor(socket.id, context.member.id))}`;
  return {
    url: module.accountLink.authorizeUrl({
      redirectUri: accountCallbackUrl(context, socket.provider),
      state,
    }),
  };
}

export interface AccountCallback {
  /** The provider the callback's path named. */
  provider: string;
  code?: string;
  state?: string;
  /** What the tool said instead of a code, when the Human said no. */
  error?: string;
}

/**
 * Finishes a link, answering where to send the browser: back to Settings ›
 * Identities, with what happened. Anything the Human or the tool did wrong is
 * said there rather than thrown, because the caller is a browser mid-redirect
 * and a JSON error would strand the Human on a blank page.
 */
export async function finishAccountLink(
  context: AppContext,
  callback: AccountCallback,
  now = new Date(),
): Promise<{ location: string }> {
  const back = `${(context.webURL ?? context.baseURL ?? "").replace(/\/+$/, "")}/settings/identities`;
  const refuse = (why: string) => ({
    location: `${back}?${new URLSearchParams({ linkError: why }).toString()}`,
  });

  const { member, workspace } = context;
  // A Human present, signed in to deevy in this browser: linking an account
  // gives it the power to rule as them (ADR-0010).
  if (
    !member ||
    !workspace ||
    member.kind !== "human" ||
    member.suspendedAt ||
    (context.principal && context.principal.kind !== "cookie")
  ) {
    return refuse("Sign in to deevy, then link your account again.");
  }

  const [socketId = "", ...signature] = (callback.state ?? "").split(".");
  const started =
    context.secret && socketId
      ? await verifyState(context.secret, signedFor(socketId, member.id), signature.join("."), now)
      : false;
  if (!started) return refuse("That link did not start here, or it took too long. Start it again.");
  if (callback.error) return refuse(`The tool did not link your account: ${callback.error}.`);
  if (!callback.code) return refuse("The tool sent nothing back to link.");

  const socket = await context.db.query.socket.findFirst({
    where: { id: socketId, workspaceId: workspace.id },
  });
  if (!socket || socket.status !== "active" || socket.provider !== callback.provider) {
    return refuse("That tool is not connected here any more.");
  }
  const module = await socketModuleFor(context, socket);
  if (!module.accountLink) return refuse(`An account on ${socket.name} is not linked this way.`);

  let account;
  try {
    account = await module.accountLink.account({
      code: callback.code,
      redirectUri: accountCallbackUrl(context, socket.provider),
    });
  } catch {
    return refuse(`${socket.name} would not say whose account it was. Start it again.`);
  }
  // The account has to live where this Socket's do: an id from another
  // workspace names somebody this tool never shows deevy.
  const scope = module.identityScope ?? { instance: socket.provider };
  if (account.instance !== scope.instance) {
    return refuse(`That account is in another workspace than the one ${socket.name} reads.`);
  }

  try {
    await linkConsentedAccount({ ...context, member, workspace }, socket, scope, account);
  } catch (error) {
    if (error instanceof ORPCError) return refuse(error.message);
    throw error;
  }
  return { location: `${back}?linked=${encodeURIComponent(socket.provider)}` };
}

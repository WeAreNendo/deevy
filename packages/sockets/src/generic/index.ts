/**
 * Any tool, through an adapter somebody wrote (docs/plans/simplify.md, slice 7).
 *
 * A tool deevy has no module for — Jira, Asana, a tracker of the team's own —
 * is connected as a generic Socket, and an adapter of the team's (a script, an
 * n8n flow) turns what the tool says into deevy's own format and signs it with
 * the secret deevy minted at connect (wire.ts). From there a record is a record:
 * deevy projects it, routes it by its label, and opens the Run, as for GitHub.
 *
 * **It says nothing back.** What deevy would announce on a record goes out as
 * the Gate's own Events on the Workspace's webhooks, each naming the record as
 * the tool knows it, and the adapter says it in the tool. Whoever holds the secret writes the deliveries, which is safe
 * because nothing in one rules: a Ruling is made in deevy (ADR-0036).
 *
 * Registered by every entry, in production too: it is a tool, not the stub.
 */
import type { SocketModule, SocketModuleInput } from "@deevy/core/sockets";
import { readEvents, verifyDelivery } from "./wire.ts";

export { deliveryHeaders, readEvents, signDelivery, verifyDelivery } from "./wire.ts";
export type { SignedDelivery } from "./wire.ts";

/**
 * Who deevy is through it. An event whose author has this id or login is
 * deevy's own, coming back, and is dropped by the loop guard — which is how an
 * adapter that hears its own comments again marks the ones it posted for deevy.
 */
const deevyItself = { login: "deevy", id: "deevy", mentionHandle: "@deevy" };

export function createGenericSocket(_input: SocketModuleInput): SocketModule {
  return {
    provider: "generic",
    capabilities: new Set(["tracker"] as const),
    // Its sender has nowhere a secret comes from but deevy.
    webhookSecretFrom: "deevy",
    // Its whole contract is deevy's own, walked on every deployment
    // (docs/acceptance.md): there is no other tool to try it against.
    walked: true,
    identity: () => Promise.resolve(deevyItself),
    tracker: {
      verifyInbound: verifyDelivery,
      normalize: (_eventName, payload) => readEvents(payload),
      createComment: () => Promise.resolve(null),
    },
  };
}

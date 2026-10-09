import type { AppRouter } from "@deevy/core";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { withBase } from "@/lib/base";

const link = new RPCLink({
  // Under the path this deevy lives under, which is the root unless it is
  // hosted or proxied there (lib/base.ts).
  url: withBase("/rpc"),
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" }),
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

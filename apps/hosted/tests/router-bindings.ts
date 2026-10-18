import type { HostedBindings } from "../src/env.ts";

/** What the router tests run the host with. */
export function bindings(): HostedBindings {
  return {
    DEEVY_HOSTED_ORIGIN: "https://app.example.com",
    DEEVY_HOSTED_MASTER_SECRET: "a-master-secret-a-master-secret-a-master-secret",
    DEEVY_SIGN_IN_RELAY_SECRET: "a-relay-secret-a-relay-secret-a-relay-secret",
  } as HostedBindings;
}

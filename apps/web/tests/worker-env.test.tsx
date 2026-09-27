import { signInProviders } from "@deevy/core";
import { fetchClientMetadataResource } from "@deevy/core/cimd";
import { describe, expect, it } from "vite-plus/test";
import { readWorkerEnv } from "../src/env.ts";
import { isolateFor } from "../src/worker.ts";

/**
 * The half of the wiring `apps/server/tests/server.test.ts` asserts from the
 * other side, and asserted at the entry rather than at the helper that builds
 * the object: what the Worker actually hands Better Auth, so a refactor that
 * inlines `workerAuthEnv` at the call site cannot quietly change the transport
 * either way. workerd has no way to fetch by address while keeping the name
 * for SNI, so the Worker takes the core's shape-checking transport with its
 * DNS-over-HTTPS pre-resolution, and the residual race is documented rather
 * than claimed away (docs/plans/m3.md slice 8, docs/OPERATIONS.md).
 */
describe("the Worker's identity configuration", () => {
  it("dereferences a client metadata document through the core transport", () => {
    const isolate = isolateFor({
      DB: undefined as never,
      BETTER_AUTH_URL: "https://deevy.example.com",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
    });

    expect(isolate.authEnv.fetchClientMetadataResource).toBe(fetchClientMetadataResource);
  });
});

/**
 * One name per provider on both runtimes (docs/plans/sign-in.md): the bindings
 * a Worker is deployed with are the variables `apps/server/src/env.ts` reads,
 * so an operator moves an instance between the two by moving values and not by
 * renaming them.
 */
describe("the Worker's sign-in providers", () => {
  it("offers the pairs its bindings carry, and only the complete ones", () => {
    const offered = (bindings: Partial<Record<string, string>>) =>
      signInProviders(readWorkerEnv({ DB: undefined as never, ...bindings })).map(
        (provider) => provider.id,
      );

    expect(
      offered({
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toEqual(["github", "google"]);
    expect(
      offered({
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
        GITLAB_CLIENT_ID: "id",
        GITLAB_CLIENT_SECRET: "secret",
        // A self-hosted GitLab is the same entry pointed somewhere else, so an
        // issuer alone offers nothing (docs/plans/sign-in.md slice 5).
        GITLAB_ISSUER: "https://gitlab.example.com",
      }),
    ).toEqual(["github", "gitlab"]);
    expect(offered({ GITLAB_ISSUER: "https://gitlab.example.com" })).toEqual([]);
    // The providers added for "More ways to sign in", and the operator's order.
    expect(
      offered({
        MICROSOFT_CLIENT_ID: "id",
        MICROSOFT_CLIENT_SECRET: "secret",
        LINEAR_CLIENT_ID: "id",
        LINEAR_CLIENT_SECRET: "secret",
        SLACK_CLIENT_ID: "id",
        SLACK_CLIENT_SECRET: "secret",
        ATLASSIAN_CLIENT_ID: "id",
        ATLASSIAN_CLIENT_SECRET: "secret",
        DEEVY_SIGN_IN_ORDER: "atlassian",
      }),
    ).toEqual(["atlassian", "microsoft", "linear", "slack"]);
    // The generic OIDC entry needs its issuer as much as its pair: without a
    // discovery document there is nothing to register (docs/plans/sign-in.md
    // slice 6).
    expect(
      offered({
        DEEVY_OIDC_CLIENT_ID: "id",
        DEEVY_OIDC_CLIENT_SECRET: "secret",
        DEEVY_OIDC_ISSUER: "https://idp.example.com/realms/deevy",
      }),
    ).toEqual(["oidc"]);
    expect(offered({ DEEVY_OIDC_CLIENT_ID: "id", DEEVY_OIDC_CLIENT_SECRET: "secret" })).toEqual([]);
    expect(offered({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toEqual(["google"]);
    expect(offered({ GOOGLE_CLIENT_ID: "id" })).toEqual([]);
    expect(offered({})).toEqual([]);
  });
});

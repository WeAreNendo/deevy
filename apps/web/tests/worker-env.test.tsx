import { MISSING_AUTH_SECRET, signInProviders } from "@deevy/core";
import { describe, expect, it, vi } from "vite-plus/test";
import { readWorkerEnv } from "../src/env.ts";
import worker from "../src/worker.ts";

/**
 * workerd shows Better Auth no `NODE_ENV`, so without `BETTER_AUTH_SECRET` it
 * signed everybody in with the default it publishes and never said so. The
 * Worker refuses everything instead, and says why (MISSING_AUTH_SECRET); the
 * smoke proves the same on workerd (scripts/smoke-workers.ts).
 */
describe("a Worker with no BETTER_AUTH_SECRET", () => {
  const bindings = {
    DB: undefined as never,
    BETTER_AUTH_URL: "https://deevy.example.com",
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
    DEEVY_ADMIN_EMAIL: "ada@example.com",
  };

  it("refuses every request, the health check and a sign-in included, and says why", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const secret of [undefined, "", "  "]) {
        for (const request of [
          new Request("https://deevy.example.com/healthz"),
          new Request("https://deevy.example.com/api/auth/sign-in/social", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: "github", callbackURL: "/" }),
          }),
        ]) {
          const response = await worker.fetch(request, { ...bindings, BETTER_AUTH_SECRET: secret });
          expect(response.status).toBe(503);
          expect(await response.text()).toBe(MISSING_AUTH_SECRET);
        }
      }
      expect(logged).toHaveBeenCalledWith(MISSING_AUTH_SECRET);
    } finally {
      logged.mockRestore();
    }
  });

  it("runs none of the background work either", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const waitUntil = vi.fn();
      worker.scheduled(undefined, bindings, { waitUntil });
      expect(waitUntil).not.toHaveBeenCalled();
      await expect(worker.queue({ messages: [] }, bindings)).rejects.toThrow(MISSING_AUTH_SECRET);
    } finally {
      logged.mockRestore();
    }
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

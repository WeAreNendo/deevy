// Used only by `pnpm generate:auth` (the `auth` CLI) to emit src/schema/auth.ts.
// It must mirror the Better Auth options that affect the schema in
// packages/core/src/auth.ts: additional user fields and plugins. It is a
// generation-time config, not a runtime one, so it opens an in-memory database.
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-sqlite";

import * as schema from "./src/schema/index.ts";

const db = drizzle(":memory:");

export const auth = betterAuth({
  baseURL: "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: { enabled: false },
  // Mirrors packages/core/src/auth.ts, whose apiKeyPlugins() this repeats:
  // only the plugin list shapes the schema, but the options stay identical so
  // the two files can be read side by side.
  plugins: [
    apiKey({
      defaultPrefix: "deevy_sk_",
      rateLimit: { enabled: false },
      customAPIKeyGetter: (ctx) => {
        const [scheme, token] = (ctx.headers?.get("authorization") ?? "").split(" ");
        if (scheme?.toLowerCase() !== "bearer" || !token) return null;
        return token.startsWith("deevy_sk_") ? token : null;
      },
    }),
    // The generic OpenID Connect provider (docs/plans/sign-in.md). It adds no
    // tables — it registers a social provider at init and nothing else — but
    // the plugin list is what shapes the schema, so it is listed here too.
    // With its endpoints named rather than discovered, so generating a schema
    // needs no network and no issuer to be up.
    genericOAuth({
      config: [
        {
          providerId: "oidc",
          clientId: "generate-only",
          clientSecret: "generate-only",
          authorizationUrl: "http://localhost:3000/authorize",
          tokenUrl: "http://localhost:3000/token",
          scopes: ["openid", "profile", "email"],
        },
      ],
    }),
  ],
  user: {
    additionalFields: {
      kind: {
        type: ["human", "agent"],
        required: false,
        defaultValue: "human",
        input: false,
      },
    },
  },
});

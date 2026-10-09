import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient } from "better-auth/client/plugins";
import { withBase } from "@/lib/base";

/**
 * `lastLoginMethodClient` reads the cookie the server's `lastLoginMethod()`
 * sets on every sign-in (packages/core/src/auth.ts), so the signed-out card
 * can put the button this browser used last first.
 */
export const authClient = createAuthClient({
  basePath: withBase("/api/auth"),
  plugins: [lastLoginMethodClient()],
});

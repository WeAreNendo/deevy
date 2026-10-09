import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient } from "better-auth/client/plugins";

/**
 * `lastLoginMethodClient` reads the cookie the server's `lastLoginMethod()`
 * sets on every sign-in (packages/core/src/auth.ts), so the signed-out card
 * can put the button this browser used last first.
 *
 * `oauthProviderClient` carries an authorization through a sign-in. An MCP
 * client or `deevy login` sends a Human who is not signed in yet to the
 * sign-in page with the authorization's signed query; the plugin hands that
 * query to the sign-in, and the server resumes the authorization once the
 * session exists, so the Human lands on the consent page rather than at home
 * with the client still waiting.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [lastLoginMethodClient(), oauthProviderClient()],
});

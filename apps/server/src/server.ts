import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mountSpa, openDatabase } from "@deevy/adapters/node";
import {
  basePathOf,
  createApp,
  createAuth,
  MISSING_AUTH_SECRET,
  signInProviders,
  type AuthEnv,
} from "@deevy/core";
import { devTrackerView, socketModules } from "@deevy/sockets";

/** Written by `vp pack` from package.json; see vite.config.ts. */
declare const __DEEVY_VERSION__: string | undefined;
const DEEVY_VERSION = typeof __DEEVY_VERSION__ === "string" ? __DEEVY_VERSION__ : undefined;
import type { ServerEnv } from "./env.ts";

/**
 * The identity configuration this entry hands Better Auth, which `buildServer`
 * hands back too, so a test can read what it was built with.
 */
function authEnv(env: ServerEnv): AuthEnv {
  return {
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: [env.webOrigin, env.baseURL].filter((o): o is string => Boolean(o)),
    providers: env.providers,
    ...(env.signInOrder ? { signInOrder: env.signInOrder } : {}),
    adminEmail: env.adminEmail,
    workspaceName: env.workspaceName,
    ...(env.signInRelay.client ? { signInRelay: env.signInRelay.client } : {}),
  };
}

/**
 * Builds the fully wired Node app. Separate from the listener so tests can
 * drive it with Request objects — and so the background runner starts beside
 * the listener rather than inside `createApp`, which owns no schedule on
 * either runtime (apps/server/src/runner.ts).
 */
export function buildServer(env: ServerEnv) {
  // Before anything is opened, so the server never comes up at all. Better
  // Auth would fall back to the default it publishes and refuse it only once a
  // sign-in reached its context, with `/healthz` answering all the while.
  // Here rather than in `readEnv`, because the import reads that too, and
  // converting a dump for D1 needs no secret (MISSING_AUTH_SECRET).
  if (!env.secret?.trim()) throw new Error(MISSING_AUTH_SECRET);
  if (env.databasePath !== ":memory:")
    mkdirSync(dirname(resolve(env.databasePath)), { recursive: true });
  const { db, close } = openDatabase({
    path: env.databasePath,
    migrationsFolder: env.migrationsFolder,
  });
  const origin = [env.webOrigin, env.baseURL].filter((o): o is string => Boolean(o));
  const identity = authEnv(env);
  const auth = createAuth({ db, env: identity });
  const app = createApp({
    // What this instance calls itself, in the API document a client discovers
    // it through, so a CLI can name the two versions that disagree rather than
    // only that they do (apps/cli/src/capabilities.ts).
    version: DEEVY_VERSION,
    db,
    auth,
    origin,
    baseURL: env.baseURL,
    // Where a Human's browser finds this instance, when the SPA is somewhere
    // else: a Gate link and an invitation link are built on it, and the API's
    // own origin serves no page in the dev loop (docs/plans/sign-in.md).
    ...(env.webOrigin ? { webURL: env.webOrigin } : {}),
    secret: env.secret,
    devSignIn: env.devStubOAuth,
    devSockets: env.devStubSockets,
    // What the stub holds, at `/dev/tracker`, wherever it is registered.
    ...(env.devStubSockets ? { devTracker: () => devTrackerView() } : {}),
    // The tools this build can speak (ADR-0024). A stub Socket is a development
    // fixture, so it is registered only where the entry says it may be, which
    // `readEnv` refuses to be production.
    sockets: socketModules({
      devStub: env.devStubSockets,
      ...(env.devStubContainers ? { devStubContainers: env.devStubContainers } : {}),
      ...(env.githubApi ? { githubApiBase: env.githubApi } : {}),
    }),
    // And what their credentials are sealed with. Without it a tool that holds
    // one cannot be connected at all (packages/core/src/secrets.ts).
    ...(env.socketSecret ? { socketSecret: env.socketSecret } : {}),
    // What the sign-in page draws its buttons from: the providers this
    // environment configured, decided where they are registered rather than in
    // the SPA (docs/plans/sign-in.md).
    signInProviders: signInProviders(identity),
    // A relay for other deployments' sign-ins, when this one is told to be.
    ...(env.signInRelay.server ? { signInRelay: env.signInRelay.server } : {}),
  });
  // Under the path of BETTER_AUTH_URL, which is the root unless an operator
  // serves deevy under a path (docs/OPERATIONS.md).
  if (env.webDist) mountSpa(app, resolve(env.webDist), basePathOf(env.baseURL));
  return { app, db, auth, close };
}

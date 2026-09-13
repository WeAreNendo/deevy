import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mountSpa, openDatabase } from "@deevy/adapters/node";
import {
  buildContext,
  createApp,
  createAuth,
  createRoomServer,
  signInProviders,
  type AuthEnv,
} from "@deevy/core";
import { fetchClientMetadataResource } from "./cimd.ts";
import type { ServerEnv } from "./env.ts";

/**
 * The identity configuration this entry hands Better Auth. Node dereferences a
 * Client ID Metadata Document through the pinning transport in
 * `apps/server/src/cimd.ts`, which resolves the name once and connects to the
 * address it checked; the Worker cannot, and passes the core's shape-checking
 * one (docs/plans/m3.md slice 8, docs/OPERATIONS.md). That is the one thing
 * that differs between the two runtimes, so `buildServer` hands back what it
 * built with this — assertable where it is decided rather than where it is
 * assembled, because a test of this function alone stays green through a
 * refactor that inlines the object below and loses the transport with it.
 */
function authEnv(env: ServerEnv): AuthEnv {
  return {
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: [env.webOrigin, env.baseURL].filter((o): o is string => Boolean(o)),
    providers: env.providers,
    adminEmail: env.adminEmail,
    workspaceName: env.workspaceName,
    fetchClientMetadataResource,
  };
}

/**
 * Builds the fully wired Node app. Separate from the listener so tests can
 * drive it with Request objects — and so the background runner starts beside
 * the listener rather than inside `createApp`, which owns no schedule on
 * either runtime (apps/server/src/runner.ts).
 */
export function buildServer(env: ServerEnv) {
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
    // The Node deployment always has rooms: the listener below serves them.
    liveDocuments: true,
    // What the sign-in page draws its buttons from: the providers this
    // environment configured, decided where they are registered rather than in
    // the SPA (docs/plans/sign-in.md).
    signInProviders: signInProviders(identity),
  });
  if (env.webDist) mountSpa(app, resolve(env.webDist));
  // The rooms live beside the app rather than inside it: `createApp` builds
  // request/response handlers, and an upgrade is neither (ADR-0021). The
  // listener wires it — `serveRooms` in `rooms.ts` — the way the background
  // runner is wired beside the listener rather than inside the app.
  const rooms = createRoomServer({
    db,
    contextFrom: (request) => buildContext(db, auth, request.headers, env.baseURL),
  });
  return { app, db, auth, rooms, close, authEnv: identity };
}

import { isAppPath } from "@deevy/adapters/spa";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { App } from "../src/app.ts";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { securityHeaders } from "../src/headers.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * The instance a hosted Workspace serves. Auth is present so the table carries
 * `/api/auth/*`, which only exists with it, and so is the stubbed tracker's
 * window, which the acceptance walk reads in a hosted Workspace.
 */
function testApp(): App {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL: "https://deevy.example.com",
      secret: "test-secret-that-is-at-least-32-characters",
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  return createApp({
    db,
    auth,
    baseURL: "https://deevy.example.com",
    devTracker: () => ({ containers: [] }),
  });
}

/** A path a request could actually carry, from one of Hono's route patterns. */
function requestPath(pattern: string): string {
  return pattern.replace(/:[^/]+/g, "sample").replace(/\*/g, "deep/path");
}

/**
 * The paths the app answers that the hosted router would hand the SPA instead.
 * Under a Workspace's path the router asks `isAppPath` which of the two a
 * request is for (apps/hosted/src/router.ts), and the SPA answers a path it
 * does not know with its index: a 200 with the wrong body, which no test of
 * createApp can see. The image needs no list, since Node mounts the SPA after
 * the app (apps/server/src/server.ts).
 */
function servedByTheSpa(app: App): string[] {
  // The headers middleware sits on every path and answers none of them.
  const answering = app.routes.filter((route) => route.handler !== securityHeaders);
  const paths = [...new Set(answering.map((route) => route.path))];
  return paths.filter((route) => !isAppPath(requestPath(route)));
}

describe("the paths the app answers under a Workspace's path", () => {
  it("are every path createApp mounts", () => {
    expect(servedByTheSpa(testApp())).toEqual([]);
  });

  it("catch a route the app grows without a path to carry it", () => {
    const app = testApp();
    app.get("/metrics", (c) => c.json({ ok: true }));

    expect(servedByTheSpa(app)).toEqual(["/metrics"]);
  });
});

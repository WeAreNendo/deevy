import { createTimerCron } from "@deevy/adapters/node";
import { serve } from "@hono/node-server";
import { readEnv } from "./env.ts";
import { socketModules } from "@deevy/sockets";
import { startRunner } from "./runner.ts";
import { buildServer } from "./server.ts";

const env = readEnv();
if (env.devStubOAuth) {
  // The same file the acceptance walk and the Workers smoke prepend to their
  // bundles, imported rather than copied so there is one stub to be wrong.
  // Installed before anything holds a reference to the real `fetch`.
  await import("../../web/scripts/stub-oauth.js");
  console.warn(
    "DEEVY_DEV_STUB_OAUTH=1: every sign-in provider is a stub; the OAuth code is the email address",
  );
}
const { app, db, close } = buildServer(env);

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`deevy listening on http://localhost:${info.port}`);
});

// Live Documents: the same room implementation the Worker runs in a Durable

// The background work runs beside the listener, never inside createApp: the
// Cloudflare Worker builds one app per isolate and gets its sweep from a Cron
// Trigger instead (apps/server/src/runner.ts).
const runner = startRunner({
  db,
  cron: createTimerCron(),
  staleMinutes: env.runStaleMinutes,
  sweepIntervalSeconds: env.sweepIntervalSeconds,
  gateReminderHours: env.gateReminderHours,
  // The origin a Slack message links back to. Without one nothing is sent, so
  // the deliveries wait in their rows until the instance knows its own URL.
  // The origin a Slack message's link is built on: the SPA's when it has one
  // of its own, else this instance's (docs/plans/sign-in.md).
  ...((env.webOrigin ?? env.baseURL) ? { baseUrl: env.webOrigin ?? env.baseURL } : {}),
  // The same registry the app was built with, so the pass can ask a tool what
  // changed on an instance no tool can reach (ADR-0024).
  sockets: socketModules({
    devStub: env.devStubOAuth,
    ...(env.githubApi ? { githubApiBase: env.githubApi } : {}),
  }),
  ...(env.socketSecret ? { socketSecret: env.socketSecret } : {}),
  socketCatchupMinutes: env.socketCatchupMinutes,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    // The sweep in flight finishes before the database closes under it.
    void runner.stop().then(() => {
      close();
      process.exit(0);
    });
  });
}

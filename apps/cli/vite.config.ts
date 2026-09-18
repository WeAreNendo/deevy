import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    // Cached, and per package: see packages/core/vite.config.ts.
    tasks: {
      // Tracked by what the suite reads, less two tool-managed files that differ
      // on every CI runner and kept every shard from replaying until 2026-09-06:
      // vitest's own results directory, and pnpm's install record (its prunedAt
      // and storeDir are the machine's). Patterns are relative to this package;
      // `**` does not reach the workspace root. A source this suite imports
      // still counts, as does a dependency's file under node_modules.
      test: {
        command: "vp test",
        input: [{ auto: true }, "!node_modules/.vite/**", "!../../node_modules/.modules.yaml"],
        output: [],
      },
    },
  },
  pack: {
    entry: ["src/main.ts"],
    platform: "node",
    format: "esm",
    dts: false,
    // One self-contained file, like the server: the CLI is published to npm and
    // a `workspace:*` dependency cannot be resolved by anybody who installs it,
    // so @deevy/core is inlined rather than depended on. The one exception is
    // Better Auth's optional tracer peer, which it reaches through a dynamic
    // import with a no-op fallback and which we do not install: bundling it is
    // impossible, so it is named rather than left to fail the build.
    deps: { alwaysBundle: [/.*/], onlyBundle: false, neverBundle: ["@opentelemetry/api"] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

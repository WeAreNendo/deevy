import { createRequire } from "node:module";
import { defineConfig } from "vite-plus";

const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

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
    // The seed is a second entry rather than a script run from source: Node
    // cannot resolve the workspace packages' `.ts` exports on its own, and the
    // pack already knows how (docs/DEVELOPMENT.md, "Running without an OAuth App").
    entry: ["src/index.ts", "src/seed.ts"],
    // The instance's own version, for the API document a client discovers it
    // through. Read here because the bundle has no package.json beside it.
    define: { __DEEVY_VERSION__: JSON.stringify(version) },
    platform: "node",
    format: "esm",
    dts: false,
    // One self-contained file: no native modules (ADR-0008), so every
    // dependency is inlined and the Docker image ships dist/ alone. The one
    // exception is Better Auth's optional tracer peer, which it reaches through
    // a dynamic import with a no-op fallback and which we do not install:
    // bundling it is impossible, so name it here rather than let every rebuild
    // print twenty lines of UNRESOLVED_IMPORT for a dependency working as meant.
    deps: { alwaysBundle: [/.*/], onlyBundle: false, neverBundle: ["@opentelemetry/api"] },
    copy: [{ from: "../../packages/db/drizzle", to: "dist" }],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

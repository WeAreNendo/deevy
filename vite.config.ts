import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "docs/research/**",
      "packages/db/drizzle/**",
      "packages/db/src/schema/auth.ts",
      "packages/core/openapi.json",
      // Written by snapshot:mcp-tools and diffed in CI; the generator owns its
      // shape, so the formatter must not have an opinion about it.
      "packages/core/mcp-tools.json",
      // Written by `changeset version` and rewritten by tools/release's fold
      // step, for the same reason as the two above: the generator owns its
      // shape, and a formatter with an opinion about it is churn on every
      // release (docs/plans/commits-and-changelogs.md).
      "CHANGELOG.md",
      // A fork of one of the Claude Design sync's own scripts, kept byte-for-byte
      // diffable against the upstream copy it was forked from.
      ".design-sync/overrides/**",
    ],
  },
  lint: {
    // The Claude Design sync's preview cards (.design-sync/previews) are
    // compiled by the sync's own esbuild, never by the app, and are written as
    // story files (many exports per file); the rules for app code do not apply.
    ignorePatterns: [".design-sync/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // shadcn components are vendored: `shadcn add --overwrite` rewrites
        // them wholesale (CLAUDE.md), so a finding in one is not something
        // anybody can act on and comes back with the next update. The rule is
        // off for that directory rather than the directory being ignored —
        // `ignorePatterns` would take the files out of the typechecker too,
        // and a real type error in a component we ship should still fail.
        files: ["apps/web/src/components/ui/**"],
        rules: { "typescript/restrict-template-expressions": "off" },
      },
      {
        files: [
          "apps/agent/**",
          "apps/cli/**",
          "apps/server/**",
          "apps/web/design-system/build.mjs",
          "apps/web/scripts/**",
          "packages/adapters/src/node/**",
          "packages/db/scripts/**",
          "packages/core/scripts/**",
          "tools/release/**",
        ],
        env: { node: true },
      },
    ],
  },
  run: {
    // package.json scripts include generators with side effects (snapshot:openapi,
    // generate), so only vite.config tasks are cached.
    cache: { scripts: false, tasks: true },
  },
});

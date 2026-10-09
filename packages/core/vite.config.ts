import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    // Named as a task so it is cached: `run.cache.scripts` is false at the root
    // for the generators' sake, and a task is the way to opt one script back in
    // without opting all of them in. Per package rather than at the root,
    // because a root task also applies to the workspace root, which has no test
    // config of its own and would run vitest over the whole tree.
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
      // The same suites on the driver a hosted Workspace's Durable Object runs
      // (tests/helpers.ts, ADR-0028). The variable is set in the command rather
      // than passed through, so it is part of what the cache fingerprints and
      // `test` above never sees it.
      "test:durable": {
        command: "DEEVY_TEST_DRIVER=durable vp test",
        input: [{ auto: true }, "!node_modules/.vite/**", "!../../node_modules/.modules.yaml"],
        output: [],
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

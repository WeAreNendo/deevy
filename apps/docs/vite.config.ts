import { defineConfig } from "vite-plus";

// Vite+'s view of the docs site: its tests and their task. Astro reads its own
// astro.config.ts and never this file.
export default defineConfig({
  run: {
    // Cached, and per package: see packages/core/vite.config.ts.
    tasks: {
      test: {
        command: "vp test",
        input: [{ auto: true }, "!node_modules/.vite/**", "!../../node_modules/.modules.yaml"],
        output: [],
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

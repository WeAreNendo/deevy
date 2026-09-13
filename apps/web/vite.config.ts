import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";

// DEEVY_TARGET=workers adds the Cloudflare plugin so `vp build` emits the Worker
// next to the SPA (ADR-0006). The default build is the plain SPA served by
// apps/server; in dev it proxies the API to the Node server.
const workers = process.env.DEEVY_TARGET === "workers";

/**
 * Where the SPA's dev proxy sends `/api`, `/rpc`, `/mcp` and the rest: the Node
 * server, on the port that server itself listens on. `DEEVY_PORT` is one
 * variable for both halves — the server reads it to bind, this reads it to
 * find — so a machine where 3000 is taken (another project, another checkout of
 * deevy) moves both with one line in `.env` instead of patching this file.
 *
 * Read from the environment rather than the root `.env`: the dev task runs
 * through `vp run -r --parallel dev`, which starts the server with
 * `--env-file-if-exists=../../.env`, and Vite's own config is loaded before any
 * of that. So an override for the proxy belongs in the shell or the launch
 * configuration, and the default stays the port `.env.example` ships.
 */
const apiOrigin =
  process.env.DEEVY_API_ORIGIN ?? `http://localhost:${process.env.DEEVY_PORT ?? "3000"}`;

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
  fmt: {},
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), ...(workers ? [cloudflare()] : [])]),
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    /*
     * The port the preview launcher picked, when there is one: it hands the
     * child a free `PORT` (`.claude/launch.json`, `autoPort`) and then opens
     * that address. `strictPort` because the alternative is worse — Vite
     * quietly moving to 5174 leaves `BETTER_AUTH_URL` pointing at a server
     * nobody is running, and sign-in fails somewhere much further from here.
     */
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      "/api": apiOrigin,
      "/rpc": apiOrigin,
      "/healthz": apiOrigin,
      // An MCP client pointed at the dev origin has to reach the server, and
      // discovery has to answer from the same origin as the endpoint it
      // describes, or the OAuth dance in slice 7 looks at the wrong server.
      "/mcp": apiOrigin,
      // A room is a websocket, and a proxy has to be told: without `ws` the
      // upgrade is answered by the dev server itself and every Document is
      // quietly empty (ADR-0021).
      "/collab": { target: apiOrigin, ws: true },
      "/.well-known": apiOrigin,
    },
  },
  test: {
    environment: "jsdom",
    /**
     * Vitest's 5s default is the wrong budget here for the same reason it was
     * wrong for `apps/agent`: a case in this suite mounts the whole router, a
     * QueryClient and a screen's worth of queries in jsdom. Alone that is under
     * a second; under `vp run -r test`, with six other packages on the same
     * CPU, cases that mount an Issue have been seen past 5s and failing on the
     * clock rather than on an assertion. A test that genuinely hangs still
     * fails, twenty seconds later rather than five.
     */
    testTimeout: 20_000,
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
});

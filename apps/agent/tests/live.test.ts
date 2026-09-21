import { afterEach, describe, expect, it } from "vite-plus/test";
import { harnessFor } from "../src/harness/index.ts";
import { buildSession } from "../src/harness/run.ts";
import { runOnce } from "../src/work.ts";
import { instance, testConfig } from "./helpers.ts";

/**
 * The one test that calls the model through a real harness, and so the one
 * test that costs money.
 *
 * CI does not set `DEEVY_AGENT_LIVE`, and neither does `vp run -r test`: a
 * milestone whose suite needs a paid key is a milestone nobody runs twice
 * (docs/plans/m4.md, convention 20). Run it by hand, with an Anthropic
 * credential on the environment:
 *
 *     DEEVY_AGENT_LIVE=1 vp run agent#test tests/live.test.ts
 */
const live = process.env.DEEVY_AGENT_LIVE === "1" ? it : it.skip;

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe("Claude, working a real Issue", () => {
  live(
    "reads the record, works it, and finishes its own Run",
    async () => {
      const deevy = await instance();
      closers.push(deevy.close);
      const server = await deevy.listen();
      closers.push(server.close);

      await deevy.asAda.issues.create({
        projectSlug: deevy.project.slug,
        title: "Give the runtime a health endpoint",
        body: [
          "## Problem",
          "An operator cannot tell whether the runtime is alive.",
          "## Proposed outcome",
          "An HTTP endpoint that answers while the loop is running.",
        ].join("\n\n"),
        assignAgent: deevy.planner.id,
      });

      const config = { ...testConfig, url: server.url, key: deevy.config.key };
      const pass = await runOnce({
        deevy: deevy.deevy,
        proxy: deevy.proxy,
        session: buildSession(config, harnessFor(config)),
        runTimeoutMs: 10 * 60 * 1000,
      });

      expect(pass.worked[0]).toMatchObject({ issueKey: "acme/deevy#1", status: "completed" });
      const feed = await deevy.asAda.runs.get({ runId: pass.worked[0].runId });
      expect(feed.activities.map((activity) => activity.kind)).toContain("action");
      expect(feed.summary?.length ?? 0).toBeGreaterThan(0);
    },
    900_000,
  );
});

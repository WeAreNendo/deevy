import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfig } from "./config.ts";
import { DeevyError, createDeevy, type Checkout, type Run } from "./deevy.ts";
import { branchFor } from "./deliver.ts";
import { harnessFor, missingFor } from "./harness/index.ts";
import type { Usage } from "./session.ts";
import { sessionUserFor } from "./session-user.ts";
import { buildSession } from "./harness/run.ts";
import { createReceiver, startListener } from "./receiver.ts";
import { startLoop } from "./loop.ts";
import { openProxy } from "./proxy.ts";
import { deevyToolNames } from "./tools.ts";
import { runOnce } from "./work.ts";
import { openWorkspace, type RepoConfig } from "./workspace.ts";

/**
 * The reference runtime, as a process.
 *
 * `--once` makes one pass and exits, which is what a cron, a person debugging,
 * and the container smoke all want. Without it the loop stays up, which is the
 * shape M4 chose over a CI job: an agent that thinks for twenty minutes bills
 * twenty minutes of runner time, and a Run stopped at a Gate may wait days
 * (docs/plans/m4.md).
 */
function configOrExit() {
  try {
    return readConfig();
  } catch (error) {
    // A stack trace for a missing environment variable helps nobody: the whole
    // of what an operator needs is the name of the one that is not set.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const config = configOrExit();

/**
 * The harness, before anything else is spent on it: the binary must be on
 * PATH and answer `--version`, and whatever its recipe requires of the
 * environment must be there. A harness the container cannot run is found at
 * boot, not at the first Run (docs/plans/harnesses.md, convention 27).
 */
const harness = (() => {
  try {
    return harnessFor(config);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
const missing = missingFor(harness);
if (missing.length > 0) {
  console.error(
    `${harness.name} needs ${missing.join(", ")} set, and the runtime refuses to start without it`,
  );
  process.exit(1);
}
const version = await promisify(execFile)(harness.binary, ["--version"]).catch((error: unknown) => {
  console.error(
    `${harness.binary} could not be run (${error instanceof Error ? error.message : String(error)}); the runtime needs it on PATH`,
  );
  process.exit(1);
});
console.log(`harness ${harness.name}: ${version.stdout.trim() || version.stderr.trim()}`);

// Said in the first lines, because a bound that is not there is worth knowing
// before a Run rather than after one (src/session-user.ts).
const sessionUser = sessionUserFor(config);
console.log(
  sessionUser
    ? `sessions run as uid ${String(sessionUser.uid)}, which cannot read this process`
    : "sessions run as this process's own user, which can read its environment: fine for trying out, not for a shared Workspace",
);

const deevy = createDeevy({ config });

/**
 * The repository configured here, as a checkout, for a Run deevy names none
 * for.
 *
 * deevy is asked first and answers for every Project bound to a forge Socket
 * (ADR-0024). This is the override, and it names its own branch — nobody else
 * is going to, and two attempts at one record still cannot collide.
 */
function override(run: Run): Checkout | null {
  const repo = config.repo;
  if (!repo) return null;
  return {
    cloneUrl: repo.url,
    baseBranch: repo.baseBranch,
    headBranch: branchFor(run.issueKey, run.id),
    username: "x-access-token",
    token: repo.token ?? "",
    expiresAt: null,
  };
}

/**
 * Who this key is, before anything else. A runtime that cannot say which Member
 * it is has nothing to poll for, and failing here with deevy's own word for the
 * refusal beats a loop that quietly finds no work forever.
 */
const who = await deevy.me().catch((error: unknown) => {
  if (error instanceof DeevyError) {
    console.error(`deevy refused this key: ${error.code} ${error.message}`);
  } else {
    console.error(`deevy is unreachable at ${config.url}: ${String(error)}`);
  }
  process.exit(1);
});
console.log(`deevy runtime is Member ${who.memberId} at ${config.url}`);

const work = {
  deevy,
  // Every commit is the Agent's, by the name and address deevy has for it.
  author: { name: who.name, email: who.email },
  session: buildSession(config, harness),
  // What a Run's usage says counted it.
  harness: harness.name,
  // The key and the tool list stay here; the session gets a loopback URL.
  proxy: (options: { onDenied: (name: string) => Promise<void> }) =>
    openProxy({ url: config.url, key: config.key, tools: deevyToolNames, ...options }),
  runTimeoutMs: config.runTimeoutSeconds * 1000,
  checkout: async (run: Run) => (await deevy.checkout(run.id)) ?? override(run),
  workspace: (options: {
    runId: string;
    repo: RepoConfig | null;
    originUrl?: string;
    author?: { name: string; email: string };
  }) => openWorkspace({ ...options, ...(config.workdir ? { root: config.workdir } : {}) }),
};

if (process.argv.includes("--once")) {
  const pass = await runOnce(work);
  console.log(`one pass: worked ${pass.worked.length}, waiting ${pass.waiting.length}`);
  process.exit(0);
}

const loop = startLoop({
  ...work,
  pollSeconds: config.pollSeconds,
  onPass: (pass) => {
    for (const result of [...pass.resumed, ...pass.worked]) {
      const spent = result.usage ? ` (${spentLine(result.usage)})` : "";
      console.log(
        `${result.issueKey} ${result.status}${result.failedBy ? `: ${result.failedBy}` : ""}${spent}`,
      );
    }
  },
});

// Polling stays on whatever this does: a runtime that only worked when a
// delivery arrived would lose a Run to every missed one.
const listener = await startListener({
  port: config.listenPort,
  ...(config.webhookSecret
    ? { receiver: createReceiver({ secret: config.webhookSecret, wake: () => loop.wake() }) }
    : {}),
});
console.log(
  config.webhookSecret
    ? `listening on ${listener.port}: /healthz, and deliveries from deevy`
    : `listening on ${listener.port}: /healthz only, no webhook secret is set`,
);

// A stop with a Run in flight aborts the session, and `workRun` then writes the
// error Activity and fails the Run before this resolves. A container restart
// must not leave a Run `active` and silent for half an hour until deevy's sweep
// calls it stale, which tells a Human nothing about why.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`${signal}: finishing the Run in flight`);
    void Promise.all([loop.stop(), listener.close()]).then(() => process.exit(0));
  });
}

await loop.done;

/** A session's usage in one line of the log: tokens across its models, and a cost where priced. */
function spentLine(usage: Usage): string {
  const sum = (pick: (model: Usage["models"][number]) => number) =>
    usage.models.reduce((total, model) => total + pick(model), 0);
  const priced = usage.models.filter((model) => model.costUsd !== undefined);
  const cost = priced.length > 0 ? `, $${sum((model) => model.costUsd ?? 0).toFixed(4)}` : "";
  return `${String(sum((model) => model.inputTokens))} in, ${String(sum((model) => model.cacheReadTokens))} cached, ${String(sum((model) => model.outputTokens))} out${cost}`;
}

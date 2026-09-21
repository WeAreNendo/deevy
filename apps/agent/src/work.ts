import { DeevyError, isOpen, type Deevy, type Ruling, type Run } from "./deevy.ts";
import { deliver, titleFor, type Delivery, type DeliverOptions } from "./deliver.ts";
import type { Forge } from "./forge.ts";
import type { GitProxy } from "./git-proxy.ts";
import type { Proxy } from "./proxy.ts";
import { branchesPushed, movedRefs, refsFrom, sentenceFor } from "./refs.ts";
import type { Session, SessionEvent, Usage } from "./session.ts";
import { openWorkspace, type Workspace } from "./workspace.ts";

export interface WorkResult {
  runId: string;
  issueKey: string;
  /** The Run's status when the runtime let go of it, read back from deevy. */
  status: Run["status"];
  /** Set when the supervisor finished the Run itself, and why. */
  failedBy?: string;
  /** The branch and pull request this Run produced, when it changed anything. */
  delivered?: Delivery;
  /** What the session spent, when its harness said. */
  usage?: Usage;
}

export interface Pass {
  /** Runs this pass drove to a conclusion, in the order it took them. */
  worked: WorkResult[];
  /** Runs a Human's ruling put back in this pass's hands. */
  resumed: WorkResult[];
  /** Runs waiting on a Human. Slice 7 acts on these; this pass only counts them. */
  waiting: Run[];
  /** Issues taken up from the inbox this pass. */
  takenUp: string[];
}

export interface WorkOptions {
  deevy: Deevy;
  session: Session;
  /**
   * deevy as the session reaches it: a loopback proxy holding the key and the
   * tool list, opened for one Run and closed after it (src/proxy.ts). The
   * supervisor hands it what to do with a refusal.
   */
  proxy: (options: { onDenied: (name: string) => Promise<void> }) => Promise<Proxy>;
  /**
   * git as the session reaches it: a loopback proxy that holds the credential
   * and forwards to the real remote (src/git-proxy.ts). Absent, or answering
   * null, the session's `origin` is the remote itself and only the supervisor
   * can push to it — which is what a runtime with no repository has anyway.
   */
  gitProxy?: () => Promise<GitProxy | null>;
  /** Aborted when the process is stopping, on top of each Run's own timeout. */
  signal?: AbortSignal;
  runTimeoutMs: number;
  /**
   * The working directory a Run gets. Defaults to an empty one, and a runtime
   * with a repository configured passes one that holds a clone of it.
   */
  workspace?: (options: { runId: string; originUrl?: string }) => Promise<Workspace>;
  /** Where a pull request is opened, when the repository has one. */
  forge?: Forge | null;
  /** How a Run's work becomes a branch and a pull request. */
  deliver?: (options: DeliverOptions) => Promise<Delivery | null>;
  /** Who a commit is by. Defaults to the Agent, since everything it does is its own. */
  author?: { name: string; email: string };
}

/**
 * One prompt for one Run.
 *
 * Deliberately thin. How to work an Issue is the instructions the session
 * carries (docs/agent-loop.md), which are the same on every Run; what changes
 * is which Run this is, and the model reads the rest for itself over MCP.
 */
export function promptFor(run: Run, ruling?: Ruling): string {
  if (!ruling) {
    return [
      `Work Run ${run.id} on Issue ${run.issueKey}.`,
      `It was opened by a ${run.trigger} trigger.`,
      "Read the Issue and the Document its State asks for before you write anything.",
    ].join(" ");
  }
  // A resumed Run gets a fresh session, so the prompt says what happened while
  // it was stopped and nothing else: the Issue, its Documents and the Run's own
  // feed are all in deevy, and reading them back is the model's first job
  // (docs/plans/m4.md).
  const note = ruling.note ? ` They said: "${ruling.note}"` : "";
  if (ruling.status === "rejected") {
    return [
      `Carry on with Run ${run.id} on Issue ${run.issueKey}.`,
      `A Human rejected the ${ruling.stateName} Gate.${note}`,
      "Read the note, read the Document it is about, and revise it.",
      "Ask for the Gate again only once you have written a new version.",
    ].join(" ");
  }
  return [
    `Carry on with Run ${run.id} on Issue ${run.issueKey}.`,
    `A Human approved the ${ruling.stateName} Gate.${note}`,
    "Read the Issue for the State it is in now, and do what that State asks for.",
  ].join(" ");
}

/**
 * One pass: take up what the inbox is holding, work every Run that is ours to
 * drive, and report what is waiting on a Human.
 *
 * Nothing is remembered between passes. The queue is `runs.list`, the claim is
 * deevy's one-open-Run-per-Issue rule, and the inbox is cleared server-side —
 * so a fresh process, a restarted container and a second host all behave the
 * same as the pass before (docs/plans/m4.md).
 */
export async function runOnce(options: WorkOptions): Promise<Pass> {
  const { deevy } = options;
  const { takenUp, answered } = await takeUpInbox(deevy);

  const resumed: WorkResult[] = [];
  for (const runId of answered) {
    if (options.signal?.aborted) break;
    resumed.push(await resumeRun(options, runId));
  }

  const worked: WorkResult[] = [];
  for (const run of await deevy.runs("pending")) {
    if (options.signal?.aborted) break;
    worked.push(await workRun(options, run));
  }

  return { worked, resumed, waiting: await deevy.runs("awaiting_input"), takenUp };
}

/**
 * Pick a Run back up because a Human ruled on the Gate it stopped at.
 *
 * deevy moved the Run from `awaiting_input` to `active` when the ruling landed
 * and told the Agent so, which is what `run_answered` exists for. So the
 * runtime never polls a Gate: it is told once, per ruling, and asking
 * `requestApproval` here is how it learns which way and with what note — the
 * same call the worked example gives the model, answering rather than asking
 * because the question is already settled.
 */
export async function resumeRun(options: WorkOptions, runId: string): Promise<WorkResult> {
  const { deevy } = options;
  const run = await deevy.run(runId);
  if (run.status !== "active") {
    return { runId: run.id, issueKey: run.issueKey, status: run.status };
  }
  const ruling = await deevy.requestApproval(run.id);
  if (ruling.status === "awaiting") {
    // Nobody has decided after all. Leave it: a Run waiting on a Human does not
    // time out, and deevy asks the approvers again on its own.
    return { runId: run.id, issueKey: run.issueKey, status: run.status };
  }
  return workRun(options, run, ruling);
}

/**
 * The inbox half of ADR-0003's polling fallback: an `assignment` Notification
 * names an Issue this Agent is expected to work.
 *
 * A Run is opened before the Notification is cleared, so a crash in between
 * leaves the work findable rather than read and forgotten. `CONFLICT` is not a
 * failure — it is deevy saying the Issue already has an open Run, which is the
 * answer that makes two hosts sharing one key safe.
 */
async function takeUpInbox(deevy: Deevy): Promise<{ takenUp: string[]; answered: string[] }> {
  const takenUp: string[] = [];
  const answered: string[] = [];
  const clear: string[] = [];
  for (const notification of await deevy.unread()) {
    if (notification.kind === "run_answered" && notification.event.subjectType === "run") {
      answered.push(notification.event.subjectId);
      clear.push(notification.id);
      continue;
    }
    if (notification.kind !== "assignment" || !notification.issue) continue;
    /*
     * Two handles for one record, on purpose (ADR-0024). deevy is asked by URL,
     * which is canonical and cannot be ambiguous across two Sockets; what is
     * reported back is the tracker's key, because that is what somebody reading
     * this runtime's log is looking at in their tracker.
     */
    const handle = notification.issue.url;
    const issueKey = notification.issue.externalKey;
    // Ask before opening one. The trigger that wrote this Notification already
    // opened a Run in the same Event, so starting one here would collide every
    // single time — a request that is known to fail on the happy path, and an
    // error in deevy's log on nothing going wrong.
    if ((await deevy.runsOn(handle)).some(isOpen)) {
      clear.push(notification.id);
      continue;
    }
    try {
      await deevy.startRun(handle);
      takenUp.push(issueKey);
    } catch (error) {
      // Still caught, and now it means what it says: another host opened one
      // between the question and the answer.
      if (!(error instanceof DeevyError) || error.code !== "CONFLICT") throw error;
    }
    clear.push(notification.id);
  }
  await deevy.markRead(clear);
  return { takenUp, answered };
}

/**
 * Drive one Run, and leave it in a state that says what happened.
 *
 * The supervisor narrates nothing the model could narrate: the instructions
 * tell it to post its own Activities, and two accounts of one Run is worse than
 * one. What the supervisor writes is the envelope — the Activity and the
 * ending a session that crashed, hung or simply stopped could not write for
 * itself, because a Run left `active` and silent tells a Human nothing until
 * the sweep calls it `stale` half an hour later.
 */
export async function workRun(
  options: WorkOptions,
  run: Run,
  ruling?: Ruling,
): Promise<WorkResult> {
  const { deevy, session, runTimeoutMs } = options;

  // Only a `pending` Run is taken up. deevy moves a Run to `active` on its first
  // Activity, so an `active` one is being driven by whoever posted it. The
  // window between listing and posting is not closed by this, and one service
  // per key is the supported shape; what this does close is the common case.
  // A resumed Run is the exception, and it is `active` because deevy put it
  // there when the ruling landed.
  if (run.status !== (ruling ? "active" : "pending")) {
    return { runId: run.id, issueKey: run.issueKey, status: run.status };
  }

  // Before the session, so a repository that cannot be cloned fails the Run
  // with a reason rather than handing the model an empty directory and letting
  // it improvise about why nothing is there.
  // Before the workspace, because the clone's `origin` is set to it: the
  // session pushes to loopback and the supervisor carries it out with the
  // credential (docs/plans/agent-owns-git.md).
  const git = (await options.gitProxy?.()) ?? null;
  let workspace: Workspace;
  try {
    workspace = await (options.workspace ?? openWorkspace)({
      runId: run.id,
      ...(git ? { originUrl: git.url } : {}),
    });
  } catch (error) {
    await git?.close();
    const detail = error instanceof Error ? error.message : String(error);
    await close(deevy, run.id, detail);
    return {
      runId: run.id,
      issueKey: run.issueKey,
      status: (await deevy.run(run.id)).status,
      failedBy: detail,
    };
  }

  // What the remote had before the Run. An Agent pushes where it likes
  // (ADR-0019), so the account of what it moved is what the runtime owes a
  // Human in place of a refusal.
  const before = workspace.repo ? await readRefs(workspace) : new Map<string, string>();

  const timeout = AbortSignal.timeout(runTimeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let failure: string | null = null;
  // Enough for a Human to see the shape of what was refused, and not so many
  // that a session in a loop fills the feed with them.
  let denialsLeft = 5;
  let delivered: Delivery | null = null;
  let usage: Usage | undefined;

  // A refusal is the one thing in the feed the model cannot report accurately
  // about itself, because all it sees is an error. Not a failure: the session
  // is told and carries on. The proxy's refusals and the harness's are the same
  // fact about the Run and go through the same function; the proxy awaits it
  // before answering the session, so the feed reads in the order it happened.
  async function refused(event: Extract<SessionEvent, { type: "denied" }>): Promise<void> {
    if (denialsLeft <= 0) return;
    denialsLeft -= 1;
    await deevy
      .postActivity(run.id, "error", `Refused ${event.name}: ${event.reason}`)
      .catch(() => undefined);
  }
  const proxy = await options.proxy({
    onDenied: (name) =>
      refused({ type: "denied", name, reason: "not in this runtime's tool list" }),
  });

  try {
    // A session that cannot reach deevy has no way to read the Issue or record
    // what it did, and will fill the gap by guessing. Ask first, the way the
    // session will, and stop here before a token is spent on it.
    const unreachable = await proxy.probe();
    if (unreachable) {
      failure = `The session could not reach deevy, so it was stopped before it started: ${unreachable}`;
    } else {
      const prompt = promptFor(run, ruling);
      for await (const event of session({
        prompt,
        cwd: workspace.cwd,
        mcpUrl: proxy.url,
        signal,
      })) {
        if (event.type === "denied") await refused(event);
        if (event.type === "done") {
          usage = event.usage;
          if (!event.ok) failure = event.detail;
        }
      }
    }
  } catch (error) {
    failure = describe(error, stopped(timeout, options.signal));
  } finally {
    await proxy.close();
    // The git proxy stays up past the session, because the supervisor's own
    // push goes through it too — closing it here rather than after the
    // delivery is a branch that never reaches the remote, which is what the
    // acceptance walk said when it did.
    // Before the directory goes: whatever the session left behind is the only
    // evidence there will ever be that this attempt did anything.
    if (workspace.repo && !failure) {
      try {
        // What the session pushed for itself, before the supervisor considers
        // pushing anything: a session that delivered has delivered, and a
        // second branch beside its own is noise (ADR-0019).
        const own = branchesPushed(await movedSince(workspace, before), workspace.repo.baseBranch);
        // What the Agent said when it finished, which is what a reviewer
        // reads: its reasoning is in the feed, and nobody opening a pull
        // request goes looking there (docs/plans/agent-owns-git.md).
        const said = (await deevy.run(run.id).catch(() => null))?.summary ?? undefined;
        delivered =
          own.length > 0
            ? await attribute(own, workspace, options, run, said)
            : await (options.deliver ?? deliver)({
                workspace,
                forge: options.forge ?? null,
                issueKey: run.issueKey,
                runId: run.id,
                author: options.author ?? {
                  name: "deevy Agent",
                  email: "agent@deevy.invalid",
                },
                ...(said ? { summary: said } : {}),
              });
      } catch (error) {
        // The work happened; only the record of it failed. Say so in the feed
        // and let the Run's own outcome stand.
        const why = error instanceof Error ? error.message : String(error);
        await deevy
          .comment(
            run.issueKey,
            `The work on Run \`${run.id}\` is done and could not be delivered: ${why}`,
          )
          .catch(() => undefined);
      }
    }
    // After the delivery, so the record covers what the supervisor pushed on
    // the session's behalf as well as what the session pushed itself.
    if (workspace.repo) {
      for (const sentence of await sentencesFor(workspace, before)) {
        await deevy.postActivity(run.id, "action", sentence).catch(() => undefined);
      }
    }
    await workspace.release();
    await git?.close();
  }

  if (delivered) await attach(deevy, run, delivered);

  // deevy writes before it answers, so what the session managed to do counts
  // whatever it reported (docs/agent-loop.md). Ask deevy rather than believe
  // the session: a Run it finished is finished, and one it left open is the
  // supervisor's to close.
  const evidence = { ...(delivered ? { delivered } : {}), ...(usage ? { usage } : {}) };
  const settled = await deevy.run(run.id);
  if (settled.status !== "pending" && settled.status !== "active" && settled.status !== "stale") {
    return { runId: run.id, issueKey: run.issueKey, status: settled.status, ...evidence };
  }

  const detail = failure ?? "The session ended without finishing this Run";
  await close(deevy, run.id, detail);
  return {
    runId: run.id,
    issueKey: run.issueKey,
    status: (await deevy.run(run.id)).status,
    failedBy: detail,
    ...evidence,
  };
}

/**
 * The evidence, attributed to the attempt that produced it.
 *
 * A comment rather than an Activity, and that is forced rather than chosen: the
 * model finishes its own Run, and a finished Run takes no more Activities, so
 * by the time there is a branch to name the feed is closed. The Link is the
 * structured record and carries `runId`, which is what makes "this pull request
 * came from that attempt" a fact rather than a coincidence (docs/plans/m3.md,
 * slice 1); the comment is what a Human reads on the Issue.
 */
async function attach(deevy: Deevy, run: Run, delivered: Delivery): Promise<void> {
  const { branch, pullRequest } = delivered;
  if (pullRequest) {
    await deevy
      .addLink(run.issueKey, {
        url: pullRequest.url,
        kind: "pull_request",
        title: `#${pullRequest.number} from ${branch}`,
        runId: run.id,
      })
      .catch(() => undefined);
  }
  const said = pullRequest
    ? `Run \`${run.id}\` pushed \`${branch}\` and opened ${pullRequest.url}`
    : `Run \`${run.id}\` pushed \`${branch}\`; no pull request was opened for this repository`;
  await deevy.comment(run.issueKey, said).catch(() => undefined);
}

/**
 * The envelope's two writes, each attempted whatever the other did. Failing to
 * say why is not a reason to leave the Run open, and failing to close it is not
 * a reason to lose the explanation.
 */
async function close(deevy: Deevy, runId: string, detail: string): Promise<void> {
  await deevy.postActivity(runId, "error", detail).catch(() => undefined);
  await deevy.finishRun(runId, "failed", detail).catch(() => undefined);
}

/**
 * Why the session stopped, when the runtime is the one that stopped it. An
 * abort's own error says nothing a Human could act on, and these two reasons
 * are the difference between "it took too long" and "we were shutting down".
 */
function stopped(timeout: AbortSignal, process?: AbortSignal): string | null {
  if (process?.aborted) return "The runtime stopped while this Run was in flight";
  if (timeout.aborted) return "The session ran past its timeout";
  return null;
}

function describe(error: unknown, instead: string | null): string {
  if (instead) return instead;
  if (error instanceof Error) return `The session stopped: ${error.message}`;
  return "The session stopped for a reason it did not give";
}

/** The refs the remote has now, read through the same origin the session pushes to. */
async function readRefs(workspace: Workspace): Promise<Map<string, string>> {
  return refsFrom(await workspace.git(["ls-remote", "origin"]).catch(() => ""));
}

/**
 * What this Run moved, as sentences for its feed.
 *
 * `merge-base --is-ancestor` needs both commits in the clone, and the clone is
 * shallow: a ref somebody else moved while the Run was working can leave the
 * old commit unfetchable, and that answers "rewritten". Erring that way is
 * deliberate — a Human told to look at something that turns out to be fine
 * costs a minute, and the other mistake costs the work.
 */
async function sentencesFor(
  workspace: Workspace,
  before: ReadonlyMap<string, string>,
): Promise<string[]> {
  return (await movedSince(workspace, before)).map(sentenceFor);
}

/** What this Run has moved on the remote so far. */
async function movedSince(
  workspace: Workspace,
  before: ReadonlyMap<string, string>,
): Promise<Awaited<ReturnType<typeof movedRefs>>> {
  return movedRefs({
    before,
    after: await readRefs(workspace),
    isAncestor: async (older, newer) => {
      // Fetching first, because a commit the session did not make is not in a
      // shallow clone until it is asked for.
      await workspace.git(["fetch", "--quiet", "origin", older, newer]).catch(() => undefined);
      return workspace
        .git(["merge-base", "--is-ancestor", older, newer])
        .then(() => true)
        .catch(() => false);
    },
  });
}

/**
 * A Run whose session pushed for itself: the supervisor opens a pull request
 * for the first branch it left and reports it, and pushes nothing.
 *
 * The first rather than all of them, because a Run is one attempt at one Issue
 * and a reviewer wants one thing to open; every branch it pushed is in the
 * feed either way (src/refs.ts).
 */
async function attribute(
  own: Array<{ branch: string; commit: string }>,
  workspace: Workspace,
  options: WorkOptions,
  run: Run,
  summary?: string,
): Promise<Delivery> {
  const [first] = own;
  const forge = options.forge ?? null;
  const pullRequest = forge
    ? await forge.open({
        branch: first.branch,
        base: workspace.repo?.baseBranch ?? "main",
        title: titleFor(run.issueKey, summary),
        body: [
          ...(summary ? [summary.trim(), ""] : []),
          `Opened by a deevy Agent working ${run.issueKey}, on the branch it pushed itself.`,
          "",
          `The Run that produced it is \`${run.id}\`, and its Activity feed in deevy is the account`,
          "of how it got here, including every ref it moved. A Human decides whether this ships.",
        ].join("\n"),
      })
    : null;
  return { branch: first.branch, commit: first.commit, pullRequest };
}

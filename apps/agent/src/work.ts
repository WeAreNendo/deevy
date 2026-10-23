import { DeevyError, isOpen, type Checkout, type Deevy, type Ruling, type Run } from "./deevy.ts";
import { branchFor, deliver, openPull, type Delivery, type DeliverOptions } from "./deliver.ts";
import { openGitProxy, type GitProxy } from "./git-proxy.ts";
import type { Proxy } from "./proxy.ts";
import { branchesPushed, movedRefs, refsFrom, sentenceFor, type MovedRef } from "./refs.ts";
import type { Session, SessionEvent, Usage } from "./session.ts";
import { openWorkspace, type RepoConfig, type Workspace } from "./workspace.ts";

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
   * supervisor hands it what to do with a refusal, and what to do before a
   * call reaches deevy.
   */
  proxy: (options: {
    onDenied: (name: string) => Promise<void>;
    onCall: (name: string, args: Record<string, unknown>) => Promise<void>;
  }) => Promise<Proxy>;
  /**
   * What this Run works in: the repository, the branch and the credential
   * deevy issues from the Project's forge Socket (ADR-0024). Defaults to
   * asking deevy; a runtime working a repository deevy has no Socket for
   * answers with its own (src/main.ts).
   */
  checkout?: (run: Run) => Promise<Checkout | null>;
  /**
   * git as the session reaches it: a loopback proxy that holds the credential
   * and forwards to the real remote (src/git-proxy.ts). Answering null leaves
   * the session's `origin` the remote itself, and only the supervisor can push
   * to it — which is what a runtime with no repository has anyway. The
   * supervisor hands it what to do once a push has landed.
   */
  gitProxy?: (
    checkout: Checkout,
    options: { onPushed: () => Promise<void> },
  ) => Promise<GitProxy | null>;
  /** Aborted when the process is stopping, on top of each Run's own timeout. */
  signal?: AbortSignal;
  runTimeoutMs: number;
  /**
   * The working directory a Run gets: a clone of what its checkout named, or
   * an empty one for a Run with no repository.
   */
  workspace?: (options: {
    runId: string;
    repo: RepoConfig | null;
    originUrl?: string;
    author?: { name: string; email: string };
  }) => Promise<Workspace>;
  /** How a Run's work becomes a branch and a pull request. */
  deliver?: (options: DeliverOptions) => Promise<Delivery | null>;
  /** Who a commit is by. Defaults to the Agent, since everything it does is its own. */
  author?: { name: string; email: string };
  /**
   * The harness the sessions run on (`DEEVY_AGENT_HARNESS`), which is what a
   * Run's usage says counted it.
   */
  harness?: string;
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
      "Read the record and what has been said on it before you write anything.",
    ].join(" ");
  }
  // A resumed Run gets a fresh session, so the prompt says what happened while
  // it was stopped and nothing else: the record, what has been said on it and
  // the Run's own feed are all in deevy, and reading them back is the model's
  // first job (docs/plans/m4.md).
  const note = ruling.note ? ` They said: "${ruling.note}"` : "";
  if (ruling.status === "rejected") {
    return [
      `Carry on with Run ${run.id} on Issue ${run.issueKey}.`,
      `A Human rejected the ${ruling.checkpoint} Gate.${note}`,
      "Read the note, and write a new Proposal that answers it.",
      "Ask for the Gate again only once you have.",
    ].join(" ");
  }
  return [
    `Carry on with Run ${run.id} on Issue ${run.issueKey}.`,
    `A Human approved the ${ruling.checkpoint} Gate.${note}`,
    "Do what you said you would do in the Proposal they approved.",
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
 * runtime never polls a Gate: it is told once, per ruling, and reading the
 * Gate here is how it learns which way and with what note — the same Gate the
 * model asked for, read rather than asked about because the question is
 * already settled (ADR-0024).
 */
export async function resumeRun(options: WorkOptions, runId: string): Promise<WorkResult> {
  const { deevy } = options;
  const run = await deevy.run(runId);
  if (run.status !== "active") {
    return { runId: run.id, issueKey: run.issueKey, status: run.status };
  }
  const ruling = await deevy.gate(run.id);
  if (!ruling || ruling.status === "awaiting") {
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
  //
  // The checkout comes first of all, because it is what says whether there is
  // a repository at all: deevy holds the Socket, mints the credential and
  // names the branch (ADR-0024). Then the git proxy, because the clone's
  // `origin` is set to it — the session pushes to loopback and the supervisor
  // carries it out with the credential (docs/plans/agent-owns-git.md).
  let git: GitProxy | null = null;
  let checkout: Checkout | null = null;
  let workspace: Workspace;
  // Every ref the Run moves is said in its feed as the supervisor sees it move:
  // each push the git proxy carries, and the delivery. Set once the clone has
  // said what the remote held before the Run.
  let ledger: Ledger | null = null;
  try {
    checkout = await (options.checkout ?? ((one: Run) => deevy.checkout(one.id)))(run);
    git = checkout
      ? await (options.gitProxy ?? defaultGitProxy)(checkout, {
          // Bounded by the Run's own deadline, like everything the session
          // waits on: a push is not over until this is.
          onPushed: () =>
            ledger ? within(ledger.tell(signal), signal).catch(() => undefined) : Promise.resolve(),
        })
      : null;
    workspace = await (options.workspace ?? openWorkspace)({
      runId: run.id,
      repo: repoFor(checkout),
      ...(git ? { originUrl: git.url } : {}),
      // The session commits in the clone itself, as the Agent.
      author: authorOf(options),
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
  const before = workspace.repo
    ? ((await readRefs(workspace)) ?? new Map<string, string>())
    : new Map<string, string>();
  if (workspace.repo) ledger = refLedger(deevy, run.id, workspace, before);

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
  // The branch, the push and the pull request, once per session. When the
  // session finishes its Run, this runs just before deevy hears the finish,
  // because a finished Run takes no more Activities and the branch pushed here
  // is one; a session that ends any other way leaves its Run open, and this
  // runs once it has ended.
  //
  // Whoever is waiting on it waits no longer than its deadline allows, and the
  // git it runs is stopped there: a hung push or pull request holds neither a
  // session's `runs_finish` past the Run's timeout nor the runtime after it.
  let delivery: Promise<void> | null = null;
  function deliverOnce(bound: AbortSignal, summary?: string): Promise<void> {
    delivery ??= (async () => {
      if (!workspace.repo) return;
      try {
        // What the session pushed for itself, before the supervisor considers
        // pushing anything: a session that delivered has delivered, and a
        // second branch beside its own is noise (ADR-0019).
        const own = branchesPushed(
          await movedSince(workspace, before, bound),
          workspace.repo.baseBranch,
        );
        // What the Agent said when it finished, which is what a reviewer
        // reads: its reasoning is in the feed, and nobody opening a pull
        // request goes looking there (docs/plans/agent-owns-git.md).
        const said = summary ?? (await deevy.run(run.id).catch(() => null))?.summary ?? undefined;
        delivered =
          own.length > 0
            ? await attribute(own, options, run, said)
            : await (options.deliver ?? deliver)({
                workspace,
                deevy,
                issueKey: run.issueKey,
                runId: run.id,
                branch: checkout?.headBranch ?? branchFor(run.issueKey, run.id),
                author: authorOf(options),
                ...(said ? { summary: said } : {}),
                signal: bound,
              });
      } catch (error) {
        // The work happened; only the record of it failed. Say so in the feed
        // and let the Run's own outcome stand.
        const why = bound.aborted
          ? "it ran out of time"
          : error instanceof Error
            ? error.message
            : String(error);
        await deevy
          .comment(
            run.issueKey,
            `The work on Run \`${run.id}\` is done and could not be delivered: ${why}`,
          )
          .catch(() => undefined);
      }
      // The git proxy said so as it carried the push; this is for an `origin`
      // with no proxy in front of it.
      await ledger?.tell(bound);
    })();
    return within(delivery, bound);
  }

  const proxy = await options.proxy({
    onDenied: (name) =>
      refused({ type: "denied", name, reason: "not in this runtime's tool list" }),
    // Any `runs_finish` for this Run, however its id arrives: deevy refuses one
    // for a Run this Agent may not finish, so a call whose id the proxy could
    // not read is still this session ending its work. One that plainly names
    // another of the Agent's Runs is the exception, because delivering this
    // Run then would cut short a session that is still working it.
    onCall: async (name, args) => {
      if (name !== "runs_finish") return;
      if (typeof args.runId === "string" && args.runId.trim() !== run.id) return;
      await deliverOnce(signal, typeof args.summary === "string" ? args.summary : undefined).catch(
        () => undefined,
      );
    },
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
        repository: workspace.repo !== null,
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
    // What the session spent, reported before the Run is settled and whatever
    // became of it: a session that failed still spent. Once per session, under
    // a key of its own, so a Run resumed after a Gate adds its next session
    // rather than replacing this one. A report deevy will not take is the
    // record of cost failing, never the record of the work.
    if (usage) {
      await deevy
        .reportUsage(run.id, {
          report: `session-${crypto.randomUUID()}`,
          harness: options.harness ?? "unknown",
          models: usage.models,
        })
        .catch(() => undefined);
    }
    // The git proxy stays up past the session, because the supervisor's own
    // push goes through it too — closing it here rather than after the
    // delivery is a branch that never reaches the remote, which is what the
    // acceptance walk said when it did.
    // Before the directory goes: whatever the session left behind is the only
    // evidence there will ever be that this attempt did anything.
    //
    // The Run's own deadline may have passed with the session, so what is left
    // gets a bound of its own, as long as a Run may take and never more than
    // five minutes: enough for a push and a pull request, and short of holding
    // the runtime, which works one Run at a time.
    const settling = AbortSignal.timeout(Math.min(runTimeoutMs, 5 * 60_000));
    if (workspace.repo && !failure) await deliverOnce(settling).catch(() => undefined);
    // Whatever moved that nothing has said yet — a session that failed still
    // pushed what it pushed — for a Run that is still open to hear it.
    if (ledger) await within(ledger.tell(settling), settling).catch(() => undefined);
    // And for one that is not. A move deevy would not take is one the feed
    // will never say: the session finished its Run without the proxy seeing
    // it, or pushed after it had. Said on the record instead, rather than lost
    // without a word.
    const unsaid = ledger?.unsaid() ?? [];
    if (unsaid.length > 0) {
      await deevy
        .comment(
          run.issueKey,
          [
            `Run \`${run.id}\` was finished before its feed could say what it moved:`,
            "",
            ...unsaid.map((sentence) => `- ${sentence}`),
          ].join("\n"),
        )
        .catch(() => undefined);
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

/** Who a commit is by: the Agent, or a stand-in where nobody said which. */
function authorOf(options: { author?: { name: string; email: string } }) {
  return options.author ?? { name: "deevy Agent", email: "agent@deevy.invalid" };
}

/** The repository a checkout names, as the workspace and the proxy want it. */
function repoFor(checkout: Checkout | null): RepoConfig | null {
  if (!checkout) return null;
  return {
    url: checkout.cloneUrl,
    token: checkout.token,
    username: checkout.username,
    baseBranch: checkout.baseBranch,
  };
}

/** git on loopback, in front of whatever the checkout named. */
function defaultGitProxy(
  checkout: Checkout,
  options: { onPushed: () => Promise<void> },
): Promise<GitProxy> {
  return openGitProxy({
    upstream: checkout.cloneUrl,
    token: checkout.token,
    username: checkout.username,
    ...options,
  });
}

/**
 * What a Human reads on the record, once there is a branch to name.
 *
 * A comment, beside the Activity the push already is in the Run's feed: the
 * feed is deevy's, and the record is where the team reads. The Link is not
 * written here — `pulls.open` attaches it as it opens the pull request, so
 * evidence is attributed to the attempt that produced it whoever asked for it
 * (packages/core/src/operations/pulls.ts).
 */
async function attach(deevy: Deevy, run: Run, delivered: Delivery): Promise<void> {
  const { branch, pullRequest } = delivered;
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

/**
 * The refs the remote has now, read through the same origin the session pushes
 * to, or null when it did not answer.
 */
async function readRefs(
  workspace: Workspace,
  signal?: AbortSignal,
): Promise<Map<string, string> | null> {
  try {
    return refsFrom(await workspace.git(["ls-remote", "origin"], { signal }));
  } catch {
    return null;
  }
}

/** Says in a Run's feed what has moved on the remote since it last said. */
interface Ledger {
  /** Reads the remote and says what moved, git stopped when `signal` is. */
  tell(signal?: AbortSignal): Promise<void>;
  /** Every sentence deevy would not take, in the order it refused them. */
  unsaid(): string[];
}

/**
 * The longest a step may hold up whoever waits on it: its own result, or a
 * refusal once `signal` is aborted. What it started is stopped by the signal
 * where it was handed one, and left to finish otherwise.
 */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * What a Run moves, said in its feed as it moves rather than when the runtime
 * lets go. The session finishes its own Run, and a finished Run takes no more
 * Activities, so a ref said after the session is a ref never said.
 *
 * Each telling reads the remote and says what changed since the last, one
 * Activity per ref, and tellings take turns: a push and the delivery behind it
 * are each said once, in the order they happened. A remote that did not answer
 * has said nothing, rather than that every ref on it is gone.
 */
function refLedger(
  deevy: Deevy,
  runId: string,
  workspace: Workspace,
  before: ReadonlyMap<string, string>,
): Ledger {
  let told = before;
  let turn = Promise.resolve();
  const refused: string[] = [];
  return {
    tell(signal) {
      turn = turn
        .then(async () => {
          const now = await readRefs(workspace, signal);
          if (!now) return;
          for (const moved of await movedBetween(workspace, told, now, signal)) {
            const sentence = sentenceFor(moved);
            await deevy.postActivity(runId, "action", sentence).catch(() => {
              refused.push(sentence);
            });
          }
          told = now;
        })
        .catch(() => undefined);
      return turn;
    },
    unsaid: () => [...refused],
  };
}

/** What this Run has moved on the remote so far. */
async function movedSince(
  workspace: Workspace,
  before: ReadonlyMap<string, string>,
  signal?: AbortSignal,
): Promise<MovedRef[]> {
  return movedBetween(workspace, before, (await readRefs(workspace, signal)) ?? before, signal);
}

/**
 * What moved between two readings of the remote.
 *
 * `merge-base --is-ancestor` needs both commits in the clone, and the clone is
 * shallow: a ref somebody else moved while the Run was working can leave the
 * old commit unfetchable, and that answers "rewritten". Erring that way is
 * deliberate — a Human told to look at something that turns out to be fine
 * costs a minute, and the other mistake costs the work.
 */
async function movedBetween(
  workspace: Workspace,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  signal?: AbortSignal,
): Promise<MovedRef[]> {
  return movedRefs({
    before,
    after,
    isAncestor: async (older, newer) => {
      const asked = await ancestry(workspace, older, newer, signal);
      if (asked !== null) return asked;
      // A commit the session did not make is not in a shallow clone until it
      // is asked for. The session may still be working in this clone, so the
      // fetch leaves it one pack and nothing else: no FETCH_HEAD in place of
      // the one it last fetched, and no loose objects it did not ask for. It
      // runs as the session's user, as all the supervisor's git here does
      // (src/workspace.ts).
      await workspace
        .git(
          [
            "-c",
            "fetch.unpackLimit=1",
            "fetch",
            "--quiet",
            "--no-write-fetch-head",
            "origin",
            older,
            newer,
          ],
          { signal },
        )
        .catch(() => undefined);
      return (await ancestry(workspace, older, newer, signal)) ?? false;
    },
  });
}

/**
 * Whether one commit is in another's history, as the clone can say without
 * fetching: null when it is missing either, which is git's exit code other
 * than 0 or 1.
 */
async function ancestry(
  workspace: Workspace,
  older: string,
  newer: string,
  signal?: AbortSignal,
): Promise<boolean | null> {
  try {
    await workspace.git(["merge-base", "--is-ancestor", older, newer], { signal });
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 1 ? false : null;
  }
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
  options: WorkOptions,
  run: Run,
  summary?: string,
): Promise<Delivery> {
  const [first] = own;
  const pullRequest = await openPull(
    { deevy: options.deevy, runId: run.id, ...(summary ? { summary } : {}) },
    first.branch,
  );
  return { branch: first.branch, commit: first.commit, pullRequest };
}

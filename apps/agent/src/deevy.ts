import type { Config } from "./config.ts";

/**
 * deevy over HTTP, with the Agent's key as a bearer token.
 *
 * Hand-written rather than generated, and narrow rather than complete: it holds
 * the handful of operations the supervisor itself calls, which is not the same
 * set the model calls over MCP. The runtime takes no dependency on
 * `packages/core` (docs/plans/m4.md), so this is also the only thing in the
 * repository that reads deevy's HTTP surface the way a stranger would — if an
 * operation is awkward from here, that is a finding about the surface.
 */
export interface Run {
  id: string;
  /** The tracker's own key for the record, which is what a Human reads. */
  issueKey: string;
  agentMemberId: string;
  triggeredByMemberId: string | null;
  trigger: "assignment" | "mention" | "schedule" | "manual" | "children_done";
  status: "pending" | "active" | "awaiting_input" | "completed" | "failed" | "stale";
  summary: string | null;
}

export type ActivityKind = "thought" | "action" | "elicitation" | "response" | "error";

/**
 * The statuses deevy counts as open, and so the ones a second Run on the same
 * Issue would collide with. `stale` is one of them: a Run that went quiet is
 * recoverable rather than finished (packages/core/src/runs.ts).
 */
const openStatuses: ReadonlyArray<Run["status"]> = ["pending", "active", "awaiting_input", "stale"];

export function isOpen(run: Run): boolean {
  return openStatuses.includes(run.status);
}

export interface Notification {
  id: string;
  kind:
    | "mention"
    | "assignment"
    | "gate_awaiting"
    | "run_awaiting_input"
    | "run_finished"
    | "run_answered";
  issue: { externalKey: string; url: string } | null;
  /** The Event it derives from. A `run.answered` names the Run in `subjectId`. */
  event: { kind: string; subjectType: string; subjectId: string };
}

/**
 * What a Human decided about the Gate a Run stopped at.
 *
 * `awaiting` means nobody has: the question is asked and the answer is a
 * Human's to give, however long that takes (docs/agent-loop.md). A Gate the
 * Agent superseded by asking again is awaiting too — nothing was decided about
 * it, and what is open is the newer question.
 */
export interface Ruling {
  status: "awaiting" | "approved" | "rejected";
  /** The Checkpoint the Run asked to pass: `plan`, `ship`, whatever it is called. */
  checkpoint: string;
  note: string | null;
  decidedByMemberId: string | null;
}

/**
 * What a Run works in, issued per Run by deevy from the Project's forge Socket
 * (ADR-0024).
 *
 * The runtime asks for this over HTTP and keeps it: `runs.checkout` is
 * deliberately not an MCP tool, because a credential in a model's context is a
 * credential in a transcript (ADR-0014). The token reaches git through the
 * supervisor's proxy and nothing else (ADR-0019).
 */
export interface Checkout {
  cloneUrl: string;
  baseBranch: string;
  /** The branch this Run works on. deevy names it so nobody invents one. */
  headBranch: string;
  /** The user the token goes with, where the provider wants one. */
  username: string;
  token: string;
  /** When it dies, as the wire carries it. A resumed Run asks again. */
  expiresAt: string | null;
}

export interface PullRequest {
  url: string;
  number: number;
}

/**
 * A refusal deevy explained, carrying the code the supervisor branches on.
 *
 * The fields are assigned rather than declared as constructor parameters:
 * Node's type stripping runs this source directly in `scripts/acceptance.ts`,
 * and a parameter property is syntax it refuses rather than erases.
 */
export class DeevyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "DeevyError";
    this.code = code;
    this.status = status;
  }
}

export interface Deevy {
  /** Who this key is, which is how the runtime learns its own Member id. */
  me(): Promise<{ memberId: string; kind: string }>;
  runs(status: Run["status"]): Promise<Run[]>;
  /**
   * This Agent's Runs on one Issue. deevy defaults the Agent to the caller and
   * ANDs the two filters, so the answer is exactly what the
   * one-open-Run-per-(Issue, Agent) rule is about.
   */
  /** An Issue is named by its id, its URL, or the key the tracker wrote (ADR-0024). */
  runsOn(issue: string): Promise<Run[]>;
  run(runId: string): Promise<Run>;
  /** Opens a Run on an Issue. A `CONFLICT` means somebody already has one open. */
  startRun(issue: string): Promise<Run>;
  postActivity(runId: string, kind: ActivityKind, body: string): Promise<void>;
  finishRun(runId: string, status: "completed" | "failed", summary: string): Promise<void>;
  /**
   * What was decided about the Gate this Run stopped at, or null when it has
   * asked for none. Reading rather than asking: the Agent asks for its own
   * Gate over MCP, and this is the supervisor finding out how it went.
   */
  gate(runId: string): Promise<Ruling | null>;
  /**
   * The repository this Run works in, or null when its Project is bound to no
   * repository — which is an ordinary Run that writes no code, not a failure.
   */
  checkout(runId: string): Promise<Checkout | null>;
  /**
   * Opens the pull request for a branch the Run pushed, through the Project's
   * forge Socket. deevy attaches it to the record itself, so the runtime does
   * not (packages/core/src/operations/pulls.ts).
   */
  openPull(input: { runId: string; head?: string; summary?: string }): Promise<PullRequest>;
  /** Says something to the Humans watching the Issue, in prose. */
  comment(issue: string, body: string): Promise<void>;
  unread(): Promise<Notification[]>;
  markRead(ids: string[]): Promise<number>;
}

/** A Gate as `gates.list` answers it, narrowed to what the supervisor reads. */
interface GateView {
  id: string;
  checkpoint: string;
  status: "open" | "approved" | "rejected" | "superseded";
  decisions: Array<{ memberId: string; decision: string; note: string | null }>;
}

export interface DeevyOptions {
  config: Config;
  /**
   * The fetch the client calls. A test hands it a deevy app's own handler, so
   * the request goes through the real routing, middleware and authentication
   * without a port to bind or a process to wait for.
   */
  fetch?: typeof globalThis.fetch;
}

export function createDeevy({ config, fetch = globalThis.fetch }: DeevyOptions): Deevy {
  async function call<T>(path: string, body?: string): Promise<T> {
    const res = await fetch(`${config.url}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      body,
      headers: {
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      // oRPC answers a refusal as JSON carrying the same code the handler threw,
      // so the supervisor branches on `CONFLICT` rather than on 409 — the code
      // is deevy's word for what happened and the status is HTTP's.
      let code = `HTTP_${res.status}`;
      let message = text.slice(0, 500);
      try {
        const body = JSON.parse(text) as { code?: string; message?: string };
        if (body.code) code = body.code;
        if (body.message) message = body.message;
      } catch {
        // Not JSON: a proxy, a gateway, or deevy falling over. Keep the body.
      }
      throw new DeevyError(code, res.status, message);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const post = (path: string, body: unknown = {}) => call<unknown>(path, JSON.stringify(body));

  return {
    async me() {
      const who = await call<{ member: { id: string; kind: string } | null }>("/me");
      if (!who.member) throw new DeevyError("FORBIDDEN", 403, "This key is not a Member");
      return { memberId: who.member.id, kind: who.member.kind };
    },
    async runs(status) {
      // No `agentMemberId`: for an Agent, asking for nothing in particular means
      // its own Runs, which is what makes this the work queue (docs/plans/m2.md).
      const page = await call<{ runs: Run[] }>(`/runs?status=${status}`);
      return page.runs;
    },
    async runsOn(issue) {
      const page = await call<{ runs: Run[] }>(`/runs?issue=${encodeURIComponent(issue)}`);
      return page.runs;
    },
    run(runId) {
      return call<Run>(`/runs/${encodeURIComponent(runId)}`);
    },
    async startRun(issue) {
      return (await post(`/issues/${encodeURIComponent(issue)}/runs`)) as Run;
    },
    async postActivity(runId, kind, body) {
      await post(`/runs/${encodeURIComponent(runId)}/activities`, { kind, body });
    },
    async finishRun(runId, status, summary) {
      await post(`/runs/${encodeURIComponent(runId)}/finish`, { status, summary });
    },
    async gate(runId) {
      // Newest first, and no `limit`: a page is one query whatever it carries,
      // and a Run that asked twice has its second question at the front.
      const page = await call<{ gates: GateView[] }>(`/gates?runId=${encodeURIComponent(runId)}`);
      const [gate] = page.gates;
      if (!gate) return null;
      // The last Ruling on it is the one that settled it, and an open Gate has
      // none: deevy refuses a second Ruling by the same Human, so "the last" is
      // "the one that reached the threshold".
      const decision = gate.decisions.at(-1) ?? null;
      return {
        status: gate.status === "approved" || gate.status === "rejected" ? gate.status : "awaiting",
        checkpoint: gate.checkpoint,
        note: decision?.note ?? null,
        decidedByMemberId: decision?.memberId ?? null,
      };
    },
    async checkout(runId) {
      // Null where the Project is bound to no repository. deevy answers rather
      // than refusing, because this is asked of every Run and a Project with
      // no code is ordinary (packages/core/src/operations/runs.ts).
      return (await post(`/runs/${encodeURIComponent(runId)}/checkout`)) as Checkout | null;
    },
    async openPull({ runId, head, summary }) {
      return (await post(`/runs/${encodeURIComponent(runId)}/pull`, {
        ...(head ? { head } : {}),
        ...(summary ? { summary } : {}),
      })) as PullRequest;
    },
    async comment(issue, body) {
      await post(`/issues/${encodeURIComponent(issue)}/comments`, { body });
    },
    async unread() {
      const page = await call<{ notifications: Notification[] }>("/inbox?unreadOnly=true");
      return page.notifications;
    },
    async markRead(ids) {
      if (ids.length === 0) return 0;
      const done = (await post("/inbox/read", { ids })) as { read: number };
      return done.read;
    },
  };
}

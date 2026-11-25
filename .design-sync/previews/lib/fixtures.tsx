// Sample data the authored previews share: a Workspace worth looking at, on
// example.com identities, shaped like the seed (apps/server/src/seed.ts): a
// tracker's records in acme/deevy, the Agents Planner and Builder, the
// Checkpoints plan and ship. Not a component (no PascalCase file name).
export interface Member {
  id: string;
  kind: "human" | "agent";
  handle: string;
  suspendedAt?: string;
  user: { name: string; image: string | null };
}

export const ada: Member = {
  id: "mem_ada000000001",
  kind: "human",
  handle: "ada",
  user: { name: "Ada Lovelace", image: null },
};
export const grace: Member = {
  id: "mem_grace0000001",
  kind: "human",
  handle: "grace",
  user: { name: "Grace Hopper", image: null },
};
export const omar: Member = {
  id: "mem_omar00000001",
  kind: "human",
  handle: "omar",
  user: { name: "Omar Haddad", image: null },
};
export const planner: Member = {
  id: "mem_planner00001",
  kind: "agent",
  handle: "planner",
  user: { name: "Planner", image: null },
};
export const builder: Member = {
  id: "mem_builder00001",
  kind: "agent",
  handle: "builder",
  user: { name: "Builder", image: null },
};
export const suspendedAgent: Member = {
  id: "mem_reviewer0001",
  kind: "agent",
  handle: "reviewer",
  suspendedAt: "2026-11-02T10:00:00Z",
  user: { name: "Reviewer", image: null },
};

export type RunStatusValue =
  | "pending"
  | "active"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "stale";

/** A Run as the Runs feed lists it: whose, on which record, how it stands. */
export interface RunRow {
  id: string;
  record: string;
  /** What the Agent said as it ended the Run; a Run still going has none. */
  summary: string | null;
  agent: Member;
  status: RunStatusValue;
  /** Working time, as `duration()` says it. */
  time: string;
  /** Its last activity, as `ago()` says it. */
  last: string;
}

/** Stopped at the plan Gate below. */
export const waitingRun: RunRow = {
  id: "run_8k2m4q9x1z7c",
  record: "acme/deevy#412",
  summary: null,
  agent: planner,
  status: "awaiting_input",
  time: "14 min",
  last: "12 minutes ago",
};

/** Stopped at the ship Gate below, with one of the two approvals it wants. */
export const shipRun: RunRow = {
  id: "run_3n7p0w5d8e2f",
  record: "acme/deevy#409",
  summary: null,
  agent: builder,
  status: "awaiting_input",
  time: "41 min",
  last: "2 hours ago",
};

export const activeRun: RunRow = {
  id: "run_5c8h1f6j2m9s",
  record: "acme/deevy#415",
  summary: null,
  agent: builder,
  status: "active",
  time: "25 min",
  last: "just now",
};

export const finishedRun: RunRow = {
  id: "run_6t1v9b4h0j3k",
  record: "acme/deevy#405",
  summary: "Opened acme/deevy#406: the webhook signature now covers the delivery id.",
  agent: builder,
  status: "completed",
  time: "22 min",
  last: "3 hours ago",
};

export const failedRun: RunRow = {
  id: "run_0r5y2u8i6o1p",
  record: "acme/ops#88",
  summary: "The registry refused the new key.",
  agent: builder,
  status: "failed",
  time: "6 min",
  last: "5 hours ago",
};

/** Newest first, one in every status. */
export const runs: RunRow[] = [
  {
    id: "run_2l6z1x4c7v0b",
    record: "acme/ops#91",
    summary: null,
    agent: builder,
    status: "pending",
    time: "0 s",
    last: "1 minute ago",
  },
  activeRun,
  waitingRun,
  shipRun,
  finishedRun,
  failedRun,
  {
    id: "run_9a4s7d2f5g8h",
    record: "acme/deevy#398",
    summary: null,
    agent: builder,
    status: "stale",
    time: "1 h 5 min",
    last: "1 day ago",
  },
];

/** A Gate as Needs me shows it: what is asked, on which record, where the count stands. */
export interface GateRow {
  id: string;
  record: string;
  /** The first line of the Proposal, which is what Needs me shows of it. */
  says: string;
  checkpoint: "plan" | "ship";
  agent: Member;
  approvals: number;
  required: number;
  asked: string;
}

export const planGate: GateRow = {
  id: "gate_5m8n2b6v9c3x",
  record: "acme/deevy#412",
  says: "Page every list by a cursor",
  checkpoint: "plan",
  agent: planner,
  approvals: 0,
  required: 1,
  asked: "12 minutes ago",
};

export const shipGate: GateRow = {
  id: "gate_1q4w7e0r3t6y",
  record: "acme/deevy#409",
  says: "Sign the delivery id",
  checkpoint: "ship",
  agent: builder,
  approvals: 1,
  required: 2,
  asked: "2 hours ago",
};

export const gates: GateRow[] = [planGate, shipGate];

/** A record deevy projected, as Work lists it: the tracker's own words. */
export interface RecordRow {
  key: string;
  title: string;
  state: "open" | "closed";
  /** The tracker's word for where it stands, not deevy's: GitHub's are lower case. */
  stateName: string;
  routedTo: Member | null;
  /** The Checkpoint of the Gate open on it, if any. */
  gate: "plan" | "ship" | null;
  changed: string;
}

export const records: RecordRow[] = [
  {
    key: "acme/deevy#412",
    title: "Cursor-based paging on every list operation",
    state: "open",
    stateName: "open",
    routedTo: planner,
    gate: "plan",
    changed: "26 minutes ago",
  },
  {
    key: "acme/deevy#409",
    title: "Say which delivery a signature covers",
    state: "open",
    stateName: "open",
    routedTo: builder,
    gate: "ship",
    changed: "3 hours ago",
  },
  {
    key: "acme/deevy#405",
    title: "Webhook signatures include the delivery id",
    state: "closed",
    stateName: "completed",
    routedTo: builder,
    gate: null,
    changed: "3 hours ago",
  },
  {
    key: "acme/ops#88",
    title: "Rotate the image signing key",
    state: "open",
    stateName: "open",
    routedTo: builder,
    gate: null,
    changed: "5 hours ago",
  },
  {
    key: "acme/deevy#401",
    title: "Keyboard shortcut cheat sheet",
    state: "open",
    stateName: "open",
    routedTo: null,
    gate: null,
    changed: "2 days ago",
  },
];

/** A Proposal, the markdown an Agent hands a Human with a Gate. */
export const proposal = `## Page every list by a cursor

Page every list operation by an opaque cursor instead of an offset.

- \`runs.list\`, \`events.list\` and \`issues.list\` take \`cursor\` and return \`next\`
- the cursor is the last row's \`seq\`, base64url-encoded
- offsets keep working for one release, then go

\`\`\`ts
const page = await client.runs.list({ cursor, limit: 50 });
\`\`\`

> Nothing changes for a caller that reads only the first page.`;

// Sample data the authored previews share: a Workspace worth looking at, on
// example.com identities, shaped like the seed (apps/server/src/seed.ts): a
// tracker's records in acme/deevy, the Agents Planner and Builder, the
// Checkpoints plan and ship. Not a component (no PascalCase file name).
export const ada = {
  id: "mem_ada000000001",
  kind: "human" as const,
  handle: "ada",
  user: { name: "Ada Lovelace", image: null },
};
export const grace = {
  id: "mem_grace0000001",
  kind: "human" as const,
  handle: "grace",
  user: { name: "Grace Hopper", image: null },
};
export const omar = {
  id: "mem_omar00000001",
  kind: "human" as const,
  handle: "omar",
  user: { name: "Omar Haddad", image: null },
};
export const planner = {
  id: "mem_planner00001",
  kind: "agent" as const,
  handle: "planner",
  user: { name: "Planner", image: null },
};
export const builder = {
  id: "mem_builder00001",
  kind: "agent" as const,
  handle: "builder",
  user: { name: "Builder", image: null },
};
export const suspendedAgent = {
  id: "mem_reviewer0001",
  kind: "agent" as const,
  handle: "reviewer",
  suspendedAt: "2026-11-02T10:00:00Z",
  user: { name: "Reviewer", image: null },
};
export const members = [ada, grace, omar, planner, builder];

type Member = (typeof members)[number];
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
  /** What the Agent last said it was doing. */
  summary: string;
  agent: Member;
  status: RunStatusValue;
  /** Working time, said the way the feed says it. */
  time: string;
  last: string;
}

export const runs: RunRow[] = [
  {
    id: "run_8k2m4q9x1z7c",
    record: "acme/deevy#412",
    summary: "Wrote the plan for cursor paging; waiting at plan",
    agent: planner,
    status: "awaiting_input",
    time: "14m",
    last: "2m",
  },
  {
    id: "run_3n7p0w5d8e2f",
    record: "acme/deevy#409",
    summary: "Adding the delivery id to the signed payload",
    agent: builder,
    status: "active",
    time: "41m",
    last: "now",
  },
  {
    id: "run_6t1v9b4h0j3k",
    record: "acme/deevy#405",
    summary: "Opened acme/deevy#406 with the signature change",
    agent: planner,
    status: "completed",
    time: "22m",
    last: "3h",
  },
  {
    id: "run_0r5y2u8i6o1p",
    record: "acme/ops#88",
    summary: "The registry refused the new key",
    agent: builder,
    status: "failed",
    time: "6m",
    last: "5h",
  },
  {
    id: "run_9a4s7d2f5g8h",
    record: "acme/deevy#398",
    summary: "Listing the components nothing imports",
    agent: builder,
    status: "stale",
    time: "1h 05m",
    last: "1d",
  },
  {
    id: "run_2l6z1x4c7v0b",
    record: "acme/ops#91",
    summary: "Queued behind acme/ops#88",
    agent: planner,
    status: "pending",
    time: "—",
    last: "1d",
  },
];

/** A Gate as Needs me shows it: the record, the Checkpoint, who asked, the count. */
export interface GateRow {
  id: string;
  record: string;
  title: string;
  checkpoint: "plan" | "ship";
  agent: Member;
  approvals: number;
  required: number;
  waited: string;
}

export const gates: GateRow[] = [
  {
    id: "gate_5m8n2b6v9c3x",
    record: "acme/deevy#412",
    title: "Cursor-based paging on every list operation",
    checkpoint: "plan",
    agent: planner,
    approvals: 0,
    required: 1,
    waited: "12m",
  },
  {
    id: "gate_1q4w7e0r3t6y",
    record: "acme/deevy#409",
    title: "Sign the delivery id",
    checkpoint: "ship",
    agent: builder,
    approvals: 1,
    required: 2,
    waited: "2h",
  },
];

/** A record deevy projected, as Work lists it: the tracker's own words. */
export interface RecordRow {
  key: string;
  title: string;
  /** The tracker's word for where it stands, not deevy's. */
  state: string;
  routedTo: Member | null;
  /** The Checkpoint of the Gate open on it, if any. */
  gate: "plan" | "ship" | null;
  changed: string;
}

export const records: RecordRow[] = [
  {
    key: "acme/deevy#412",
    title: "Cursor-based paging on every list operation",
    state: "Open",
    routedTo: planner,
    gate: "plan",
    changed: "12m",
  },
  {
    key: "acme/deevy#409",
    title: "Sign the delivery id",
    state: "Open",
    routedTo: builder,
    gate: "ship",
    changed: "2h",
  },
  {
    key: "acme/deevy#405",
    title: "Webhook signatures include the delivery id",
    state: "Closed",
    routedTo: planner,
    gate: null,
    changed: "3h",
  },
  {
    key: "acme/ops#88",
    title: "Rotate the image signing key",
    state: "Open",
    routedTo: builder,
    gate: null,
    changed: "5h",
  },
  {
    key: "acme/deevy#401",
    title: "Keyboard shortcut cheat sheet",
    state: "Open",
    routedTo: null,
    gate: null,
    changed: "2d",
  },
];

/** A Proposal, the markdown an Agent hands a Human with a Gate. */
export const proposal = `## Plan

Page every list operation by an opaque cursor instead of an offset.

- \`runs.list\`, \`events.list\` and \`issues.list\` take \`cursor\` and return \`next\`
- the cursor is the last row's \`seq\`, base64url-encoded
- offsets keep working for one release, then go

\`\`\`ts
const page = await client.runs.list({ cursor, limit: 50 });
\`\`\`

> Nothing changes for a caller that reads only the first page.`;

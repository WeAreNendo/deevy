/**
 * The landing's workflow graph as data: one Issue's way through deevy, drawn
 * by Hero.astro at build time and walked by its script in the browser. Three
 * rows: the way in (the tracker, deevy, the Agent, its Checkpoint, the Gate),
 * the three places a Human can rule, and the way back to the tracker.
 */

export type Kind = "tool" | "deevy" | "agent" | "gate" | "human";

export interface Node {
  id: string;
  x: number;
  y: number;
  title: string;
  detail: string;
  kind: Kind;
}

/** A node's box, in the graph's own units. */
export const box = { width: 180, height: 64 };

/** The graph's viewBox: three rows of nodes and the room the wires need between them. */
export const viewBox = { width: 1160, height: 452 };

export const nodes: Node[] = [
  { id: "linear", x: 30, y: 40, title: "Linear", detail: "ENG-12 to deevy", kind: "tool" },
  { id: "route", x: 260, y: 40, title: "deevy · route", detail: "Project Billing", kind: "deevy" },
  { id: "run", x: 490, y: 40, title: "builder", detail: "run_27gmbk2vhwh8", kind: "agent" },
  {
    id: "check",
    x: 720,
    y: 40,
    title: "plan Checkpoint",
    detail: "Proposal ready",
    kind: "agent",
  },
  { id: "gate", x: 950, y: 40, title: "Gate", detail: "waits for a Human", kind: "gate" },
  { id: "needs", x: 490, y: 200, title: "Needs me", detail: "in deevy", kind: "human" },
  {
    id: "comment",
    x: 720,
    y: 200,
    title: "/approve",
    detail: "comment on ENG-12",
    kind: "human",
  },
  {
    id: "slack",
    x: 950,
    y: 200,
    title: "Slack · #billing",
    detail: "Approve button",
    kind: "human",
  },
  { id: "ruling", x: 490, y: 360, title: "Ruling", detail: "gate.approved", kind: "human" },
  { id: "pr", x: 260, y: 360, title: "Pull request", detail: "acme/billing#88", kind: "agent" },
  { id: "back", x: 30, y: 360, title: "Linear", detail: "comment · Finished", kind: "tool" },
];

/** Which way a wire leaves its node: along a row, down between rows, or back up the side. */
type Way = "right" | "left" | "down" | "loop";

export const edges: [string, string, Way][] = [
  ["linear", "route", "right"],
  ["route", "run", "right"],
  ["run", "check", "right"],
  ["check", "gate", "right"],
  ["gate", "needs", "down"],
  ["gate", "comment", "down"],
  ["gate", "slack", "down"],
  ["needs", "ruling", "down"],
  ["comment", "ruling", "down"],
  ["slack", "ruling", "down"],
  ["ruling", "pr", "left"],
  ["pr", "back", "left"],
  ["back", "linear", "loop"],
];

const byId = new Map(nodes.map((node) => [node.id, node]));
function node(id: string): Node {
  const found = byId.get(id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
}

type Point = [number, number];
const at = ([x, y]: Point) => `${x},${y}`;

export interface Wire {
  key: string;
  d: string;
  loop: boolean;
  from: Point;
  to: Point;
}

/** Every wire runs port to port: straight along a row, an S-curve between rows. */
export const wires: Wire[] = edges.map(([fromId, toId, way]) => {
  const a = node(fromId);
  const b = node(toId);
  const { width: w, height: h } = box;
  let from: Point;
  let to: Point;
  let d: string;
  if (way === "right") {
    from = [a.x + w, a.y + h / 2];
    to = [b.x, b.y + h / 2];
    d = `M${at(from)} L${at(to)}`;
  } else if (way === "left") {
    from = [a.x, a.y + h / 2];
    to = [b.x + w, b.y + h / 2];
    d = `M${at(from)} L${at(to)}`;
  } else if (way === "loop") {
    from = [a.x + w / 2, a.y];
    to = [b.x + w / 2, b.y + h];
    d = `M${at(from)} L${at(to)}`;
  } else {
    from = [a.x + w / 2, a.y + h];
    to = [b.x + w / 2, b.y];
    const middle = (from[1] + to[1]) / 2;
    d = `M${at(from)} C${at([from[0], middle])} ${at([to[0], middle])} ${at(to)}`;
  }
  return { key: `${fromId}>${toId}`, d, loop: way === "loop", from, to };
});

/** The ports where wires meet nodes, once each. */
export const ports: Point[] = [
  ...new Map(wires.flatMap((wire) => [wire.from, wire.to]).map((p) => [at(p), p])).values(),
];

/** The way a Run goes: in, through one of the three channels, and back. */
export const route = {
  in: ["linear>route", "route>run", "run>check", "check>gate"],
  channels: {
    needs: ["gate>needs", "needs>ruling"],
    comment: ["gate>comment", "comment>ruling"],
    slack: ["gate>slack", "slack>ruling"],
  } as Record<string, string[]>,
  out: ["ruling>pr", "pr>back", "back>linear"],
};

/** What the board's status line says while a Run is on each wire. */
export const status: Record<string, string> = {
  "linear>route": "handed to deevy in Linear",
  "route>run": "routed to builder",
  "run>check": "builder is working",
  "check>gate": "Proposal on its way to the Gate",
  "gate>needs": "approved in deevy",
  "gate>comment": "approved with /approve",
  "gate>slack": "approved from Slack",
  "needs>ruling": "Ruling recorded",
  "comment>ruling": "Ruling recorded",
  "slack>ruling": "Ruling recorded",
  "ruling>pr": "pull request opening",
  "pr>back": "Linear hears back",
  "back>linear": "finished",
};

/** The Run's colour on each wire: an Agent's while it works, done once ruled, a Human's otherwise. */
export function packetKind(key: string): "agent" | "done" | "human" {
  if (key === "run>check" || key === "check>gate") return "agent";
  if (key === "ruling>pr" || key === "pr>back" || key === "back>linear") return "done";
  return "human";
}

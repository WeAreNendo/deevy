import type { ChatGateMessage, ChatMessage } from "@deevy/core/sockets";

/**
 * What a message looks like in Slack: Block Kit, built from what deevy decided
 * to say (ADR-0024). Pure, so a test reads the blocks rather than a screen.
 */

/** Slack's own limit on one section's text, less room for an ellipsis. */
const SECTION_CHARS = 2900;

/** The three characters Slack's mrkdwn treats as markup of its own. */
function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Markdown, as an Agent writes a Proposal, read in Slack's dialect: a heading
 * becomes a bold line and `**bold**` becomes `*bold*`. The rest of markdown
 * reads well enough as it is, and a faithful converter would be a second
 * renderer to keep in step with the first.
 */
export function mrkdwn(markdown: string): string {
  const converted = escape(markdown)
    .split("\n")
    .map((line) => {
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      return heading ? `*${heading[1] ?? ""}*` : line;
    })
    .join("\n")
    .replaceAll(/\*\*(.+?)\*\*/g, "*$1*");
  return converted.length > SECTION_CHARS ? `${converted.slice(0, SECTION_CHARS)}…` : converted;
}

type Block = Record<string, unknown>;

const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string): Block => ({
  type: "context",
  elements: [{ type: "mrkdwn", text }],
});

/** What the Gate says it is waiting for, and how far it has got. */
function arithmetic(gate: ChatGateMessage): string {
  if (gate.status === "approved")
    return `Approved · ${String(gate.approvals)} of ${String(gate.required)}`;
  if (gate.status === "rejected") return "Rejected";
  if (gate.status === "superseded") return "Superseded by a newer Proposal";
  return `${String(gate.approvals)} of ${String(gate.required)} approvals`;
}

export function gateBlocks(gate: ChatGateMessage): Block[] {
  const asked = [gate.agentName ? `Asked by ${escape(gate.agentName)}` : null, gate.runId]
    .filter(Boolean)
    .join(" · ");
  const blocks: Block[] = [
    section(
      `*${gate.status === "open" ? "Waiting on a ruling" : "Ruled"} at the \`${escape(gate.checkpoint)}\` Checkpoint* · <${gate.issueUrl}|${escape(gate.issueKey)}>`,
    ),
    section(mrkdwn(gate.proposal)),
    context(`*${arithmetic(gate)}* · ${asked}`),
  ];
  if (gate.rulings.length > 0) {
    blocks.push(context(gate.rulings.map(escape).join(" · ")));
  }
  // Where to rule, which is in deevy and nowhere else (ADR-0036): a link
  // rather than a button, because a button sends Slack's click to an app that
  // takes nothing from Slack.
  blocks.push(
    context(
      gate.status === "open"
        ? `<${gate.url}|Rule on it in deevy>`
        : `<${gate.url}|Open it in deevy>`,
    ),
  );
  return blocks;
}

/** The fallback text Slack shows in a notification, and the blocks it draws. */
export function render(message: ChatMessage): { text: string; blocks: Block[] } {
  if (message.kind === "gate") {
    const gate = message.gate;
    return {
      text: `${gate.status === "open" ? "Waiting on a ruling" : arithmetic(gate)} at the ${gate.checkpoint} Checkpoint: ${gate.issueKey}`,
      blocks: gateBlocks(gate),
    };
  }
  const line = message.link
    ? `${escape(message.text)} <${message.link.url}|${escape(message.link.label)}>`
    : escape(message.text);
  return { text: message.text, blocks: [section(line)] };
}

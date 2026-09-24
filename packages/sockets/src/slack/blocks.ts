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
  // The buttons only while there is something to decide: a decided Gate that
  // still offered them would take a click and refuse it.
  blocks.push({
    type: "actions",
    block_id: "gate",
    elements: [
      ...(gate.status === "open"
        ? [
            {
              type: "button",
              action_id: "deevy_approve",
              text: { type: "plain_text", text: "Approve" },
              style: "primary",
              value: gate.gateRequestId,
            },
            {
              type: "button",
              action_id: "deevy_reject",
              text: { type: "plain_text", text: "Reject" },
              style: "danger",
              value: gate.gateRequestId,
            },
          ]
        : []),
      {
        type: "button",
        action_id: "deevy_open",
        text: { type: "plain_text", text: "Open in deevy" },
        url: gate.url,
      },
    ],
  });
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

/** The dialog a rejection asks its reason in, carrying which Gate and which message. */
export function noteView(input: {
  gateRequestId: string;
  checkpoint: string;
  message: { channel: string; ts: string } | null;
}): Block {
  return {
    type: "modal",
    callback_id: "deevy_reject",
    private_metadata: JSON.stringify({
      gateRequestId: input.gateRequestId,
      ...(input.message ? { channel: input.message.channel, ts: input.message.ts } : {}),
    }),
    title: { type: "plain_text", text: "Reject" },
    submit: { type: "plain_text", text: "Reject" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "note",
        label: { type: "plain_text", text: `Why not, at ${input.checkpoint.slice(0, 60)}?` },
        element: { type: "plain_text_input", action_id: "note", multiline: true },
      },
    ],
  };
}

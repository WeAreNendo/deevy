import type { HumanNotificationKind } from "@deevy/db";
import { headlines, workItemUrl } from "../slack.ts";

/**
 * What an email says (docs/plans/email-channel.md): a pure function of the
 * Notification, called when it is sent rather than when it is owed, like
 * `slackMessage`, so the third attempt says what the first would have.
 *
 * Both bodies, always. The HTML is one table and inline styles, which every
 * client renders, in deevy's indigo, with no images and nothing that tracks
 * whether it was opened.
 */

export interface EmailIssue {
  /** deevy's id, which its Work item is named by. */
  id: string;
  /** The tracker's key, which is what a Human recognises. */
  key: string;
  title: string;
  /** Where the record lives, in its tracker. */
  url: string;
}

export interface EmailGate {
  id: string;
  checkpoint: string;
  proposal: string;
  agentName: string | null;
  approvals: number;
  required: number;
}

export interface RenderInput {
  kind: HumanNotificationKind;
  /** Where a Human opens deevy, so every link is one they can click. */
  baseUrl: string;
  workspaceName: string;
  issue?: EmailIssue | null;
  /** For a Gate awaiting them. */
  gate?: EmailGate | null;
  /** For a Run awaiting their answer: what the Agent asked, and the Run. */
  question?: string | null;
  runId?: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** How much of a Proposal an email quotes: enough to decide whether to open it. */
const excerptLength = 600;

/**
 * Markdown as the prose it stands for: an Agent writes its Proposal in
 * markdown for deevy to render, and an email quoting `## What I will do` and
 * backticks at somebody reads as a leak. Headings, emphasis, code spans and
 * links lose their markup and keep their words; a list keeps its items; a
 * paragraph hard-wrapped in the source reads as one paragraph.
 */
export function prose(markdown: string): string {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    // A fence is markup; what it holds is still worth reading.
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)]|$)/g, "$1$2")
        .replace(/`([^`]*)`/g, "$1")
        .trimEnd(),
    );
  // Lines of one paragraph join with a space; a list item, a blank line or a
  // line after a blank one starts a new one.
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (line.trim() === "") {
      if (previous !== undefined && previous !== "") out.push("");
      continue;
    }
    // A new paragraph, a list item, or the line after one starts its own line.
    if (
      previous === undefined ||
      previous === "" ||
      line.startsWith("• ") ||
      previous.startsWith("• ")
    ) {
      out.push(line.trim());
    } else {
      out[out.length - 1] = `${previous} ${line.trim()}`;
    }
  }
  return out.join("\n").trim();
}

/** The first stretch of a Proposal, cut at a word and marked as cut. */
export function excerpt(text: string, length = excerptLength): string {
  const flat = text.trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(0, length);
  const space = cut.lastIndexOf(" ");
  return `${(space > length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One paragraph of plain text as HTML, its line breaks kept. */
function paragraph(text: string, style = ""): string {
  return `<p style="margin:0 0 16px;${style}">${escape(text).replace(/\n/g, "<br>")}</p>`;
}

interface Body {
  subject: string;
  headline: string;
  /** Paragraphs, plain. */
  lines: string[];
  /** A quoted block — the Proposal, the question — when there is one. */
  quote: string | null;
  action: { label: string; url: string } | null;
}

function bodyOf(input: RenderInput): Body {
  const origin = input.baseUrl.replace(/\/+$/, "");
  const { issue, gate } = input;
  const on = issue ? `${issue.key} ${issue.title}` : null;
  const record = issue ? `${issue.key} · ${issue.title}\n${issue.url}` : null;

  if (input.kind === "gate_awaiting" && gate) {
    const asking = gate.agentName ?? "An Agent";
    const count = `${String(gate.approvals)} of ${String(gate.required)} approval${gate.required === 1 ? "" : "s"} so far`;
    return {
      subject: issue
        ? `Gate waiting: ${issue.key} · ${gate.checkpoint}`
        : `Gate waiting: ${gate.checkpoint}`,
      headline: `${asking} is waiting for you at ${gate.checkpoint}`,
      lines: [
        ...(record ? [record] : []),
        `${asking} asks to pass the ${gate.checkpoint} Checkpoint. ${count}.`,
      ],
      quote: excerpt(prose(gate.proposal)),
      action: { label: "Open the Gate", url: `${origin}/gates/${encodeURIComponent(gate.id)}` },
    };
  }
  if (input.kind === "run_awaiting_input") {
    return {
      subject: issue ? `Waiting for your answer: ${issue.key}` : "A Run is waiting for your answer",
      headline: "A Run is waiting for your answer",
      lines: record ? [record] : [],
      quote: input.question ? excerpt(prose(input.question)) : null,
      action: input.runId
        ? { label: "Answer in deevy", url: `${origin}/runs/${encodeURIComponent(input.runId)}` }
        : issue
          ? { label: "Open it in deevy", url: workItemUrl(origin, issue.id) }
          : null,
    };
  }
  const headline = headlines[input.kind];
  return {
    subject: on ? `${headline}: ${on}` : headline,
    headline,
    lines: record ? [record] : [],
    quote: null,
    action: issue ? { label: "Open it in deevy", url: workItemUrl(origin, issue.id) } : null,
  };
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const body = bodyOf(input);
  const origin = input.baseUrl.replace(/\/+$/, "");
  const settings = `${origin}/settings/notifications`;
  const why = `You get this because you are a Member of ${input.workspaceName} on deevy.`;
  const stop = `Change what deevy emails you: ${settings}`;

  const text = [
    body.headline,
    "",
    ...body.lines.flatMap((line) => [line, ""]),
    ...(body.quote ? [body.quote.replace(/^/gm, "> "), ""] : []),
    ...(body.action ? [`${body.action.label}: ${body.action.url}`, ""] : []),
    "—",
    why,
    stop,
  ].join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(body.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e5ee;border-radius:8px;">
<tr><td style="padding:28px 28px 8px;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1d2433;">
<p style="margin:0 0 20px;font-size:13px;font-weight:600;color:#4f46e5;">${input.workspaceName === "deevy" ? "deevy" : `deevy · ${escape(input.workspaceName)}`}</p>
<h1 style="margin:0 0 16px;font-size:18px;line-height:1.35;font-weight:600;color:#1d2433;">${escape(body.headline)}</h1>
${body.lines.map((line) => paragraph(line, "color:#4b5468;")).join("\n")}
${
  body.quote
    ? `<blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #c7c9f4;background:#f7f7fd;color:#1d2433;white-space:pre-wrap;">${escape(body.quote)}</blockquote>`
    : ""
}
${
  body.action
    ? `<p style="margin:0 0 24px;"><a href="${escape(body.action.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;">${escape(body.action.label)}</a></p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eceef4;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#7a8296;">
${escape(why)} <a href="${escape(settings)}" style="color:#7a8296;">Change what deevy emails you</a>.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject: body.subject, text, html };
}

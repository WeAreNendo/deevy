import type { HumanNotificationKind } from "@deevy/db";

/**
 * Slack, the second Channel a Notification can reach (CONTEXT.md). An incoming
 * webhook is a plain JSON POST with no SDK and no signing on our side, so this
 * module is two things: the Block Kit payload each Notification kind becomes,
 * and the POST that carries it.
 *
 * Web-standard only (ADR-0006): `fetch` is a parameter rather than a global so
 * a test never reaches the network and a Worker needs no shim.
 */

/** A Block Kit section, the one block type these messages use. */
export interface SlackSection {
  type: "section";
  text: { type: "mrkdwn"; text: string };
}

export type SlackBlock = SlackSection;

export interface SlackPayload {
  /** The fallback Slack shows in a list and a push notification. */
  text: string;
  blocks: SlackBlock[];
}

export interface SlackIssue {
  /** deevy's own id for the record, which its page in deevy is named by. */
  id: string;
  /** The tracker's key, which is what a Human recognises. */
  key: string;
  title: string;
}

export interface SlackMessageInput {
  /**
   * Human kinds only. A Slack message exists because a routing rule named a
   * kind, and a rule cannot name an Agent's (schema/channel.ts).
   */
  kind: HumanNotificationKind;
  /** The Issue this is about. A Notification without one still says what happened. */
  issue?: SlackIssue | null;
  /** The public origin of this instance, so the link is one a Human can click. */
  baseUrl: string;
}

/**
 * What each kind of Notification says, in CONTEXT.md's words
 * (schema/notification.ts). Keyed by the Human kinds rather than by all of
 * them: Slack is a room full of Humans, `run_answered` is owed to the Agent
 * that asked, and the Workspace's routing rules cannot name it.
 */
const headlines: Record<HumanNotificationKind, string> = {
  mention: "You were mentioned",
  assignment: "An Issue was assigned",
  gate_awaiting: "A Gate is waiting for a Human",
  run_awaiting_input: "A Run is waiting for an answer",
  run_finished: "A Run finished",
  delegation: "An Agent split work into sub-issues",
};

/**
 * The Issue's page on this instance: its Work item, by deevy's id for it. The
 * key names it in the words; it is the tracker's, and `/issues/<key>` went
 * with deevy's own tracker (ADR-0024).
 */
export function workItemUrl(baseUrl: string, issueId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/work/${encodeURIComponent(issueId)}`;
}

/**
 * Slack's mrkdwn reads `&`, `<` and `>` as markup, so an Issue title carrying
 * one would break the link beside it.
 */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The message one Notification becomes: what happened, and a link back to the
 * Issue it happened on. Deciding this here rather than at delivery keeps the
 * payload a pure function of the Notification, so it is the same message
 * whether it is sent now or on the third attempt.
 */
export function slackMessage({ kind, issue, baseUrl }: SlackMessageInput): SlackPayload {
  const headline = headlines[kind];
  const link = issue
    ? `<${workItemUrl(baseUrl, issue.id)}|${escape(issue.key)} ${escape(issue.title)}>`
    : null;
  const text = issue ? `${headline}: ${issue.key} ${issue.title}` : headline;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: link ? `*${headline}*\n${link}` : `*${headline}*` },
      },
    ],
  };
}

/** What one POST to an incoming webhook came back with. */
export interface SlackPostResult {
  delivered: boolean;
  status: number;
  /** Slack's body on a refusal, for the Event and the Test button to quote. */
  error?: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Posts one message to a Slack incoming webhook. It never throws: a Channel
 * being down is an outcome the caller retries, not an error that unwinds the
 * pass it is part of.
 */
export async function postSlackMessage(
  webhookUrl: string,
  payload: SlackPayload,
  fetchImpl: FetchLike = fetch,
): Promise<SlackPostResult> {
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { delivered: true, status: response.status };
    // Slack answers a bad webhook with a short body such as `invalid_token`,
    // which is the only diagnosis an operator gets.
    const error = await response.text().catch(() => "");
    return { delivered: false, status: response.status, error: error.slice(0, 200) };
  } catch (failure) {
    return {
      delivered: false,
      status: 0,
      error: failure instanceof Error ? failure.message : "the request did not complete",
    };
  }
}

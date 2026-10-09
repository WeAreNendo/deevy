import { renderPlain, type RenderedEmail } from "./render.ts";

/**
 * What an invitation's email says (docs/plans/email-channel.md, slice 6): who
 * invited them, to what, as what, until when, and the one link that accepts.
 */
export function renderInvitation({
  workspaceName,
  inviterName,
  role,
  expiresAt,
  url,
}: {
  workspaceName: string;
  inviterName: string | null;
  role: string;
  expiresAt: Date;
  url: string;
}): RenderedEmail {
  const who = inviterName ?? "An admin";
  const until = expiresAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return renderPlain({
    workspaceName,
    // "on deevy" says where, unless the Workspace is itself called deevy.
    subject:
      workspaceName === "deevy"
        ? `${who} invited you to deevy`
        : `${who} invited you to ${workspaceName} on deevy`,
    headline: workspaceName === "deevy" ? "Join deevy" : `Join ${workspaceName} on deevy`,
    lines: [
      `${who} invited you to ${workspaceName}${role === "admin" ? " as an admin" : ""}, where Humans and Agents work the same Issues and a Human rules on what an Agent proposes.`,
      `Sign in with this address to accept. The invitation works until ${until}.`,
    ],
    action: { label: "Accept the invitation", url },
    footer:
      "If you weren't expecting this, ignore it: nothing happens unless you accept, and the link stops working on its own.",
  });
}

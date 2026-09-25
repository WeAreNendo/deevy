/**
 * What started a Run, in words: the Run's page says "started …" and the feed
 * "started a Run, …". A trigger is a value the server stores, and a screen
 * that printed it put `children_done` in front of a Human.
 */
export function startedBy(trigger: string | null | undefined): string {
  switch (trigger) {
    case "assignment":
      return "by assignment";
    case "mention":
      return "by a mention";
    case "schedule":
      return "on its schedule";
    case "children_done":
      return "when its sub-issues finished";
    case "retry":
      return "to try again";
    case "manual":
      return "by the Agent itself";
    default:
      return trigger ? `by ${trigger}` : "";
  }
}

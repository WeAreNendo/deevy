/**
 * What a tool is called on screen (ADR-0024).
 *
 * The provider is deevy's own word — `github`, `linear` — and a Human reads
 * the tool's. A Socket that is one of a kind deevy has no name for falls back
 * to the name the operator gave it, which is what they will recognise.
 */
const names: Record<string, string> = {
  github: "GitHub",
  linear: "Linear",
  gitlab: "GitLab",
  notion: "Notion",
  slack: "Slack",
  stub: "the stub tracker",
};

export function providerLabel(provider?: string | null, name?: string | null): string {
  if (provider && names[provider]) return names[provider];
  return name ?? provider ?? "another tool";
}

/**
 * The kinds of rule that let somebody join a Workspace by signing in, and the
 * sign-in each is decided by. Settings › General offers a kind only where it
 * can work, and the page somebody sees when no rule has let them in yet names
 * only those, from the same two facts: this map and `health.ping`'s providers.
 */
export const ruleKindLabels = {
  email_domain: "Email domain",
  github_org: "GitHub organization",
  gitlab_group: "GitLab group",
} as const;

export type RuleKind = keyof typeof ruleKindLabels;

export const ruleKinds = Object.keys(ruleKindLabels) as RuleKind[];

/**
 * The sign-in a kind of rule is decided by. A GitHub organization rule asks
 * the GitHub account somebody signed in with which organizations it is in, and
 * a GitLab group rule their GitLab account, so where nobody signs in with that
 * provider the rule lets nobody in — deevy Cloud has no GitLab sign-in. The
 * server refuses such a rule too (`allowlistRuleSignIn` in packages/core).
 */
export const ruleKindSignIns = {
  email_domain: null,
  github_org: { id: "github", label: "GitHub" },
  gitlab_group: { id: "gitlab", label: "GitLab" },
} as const satisfies Record<RuleKind, { id: string; label: string } | null>;

/** A kind as a sentence says it: "your email domain", "your GitHub organization". */
const ruleKindNouns = {
  email_domain: "email domain",
  github_org: "GitHub organization",
  gitlab_group: "GitLab group",
} as const satisfies Record<RuleKind, string>;

/** Kinds as one sentence names them: "email domain, GitHub organization or GitLab group". */
export function ruleKindsSaid(kinds: readonly RuleKind[]): string {
  const nouns = kinds.map((kind) => ruleKindNouns[kind]);
  if (nouns.length <= 1) return nouns[0] ?? "";
  return `${nouns.slice(0, -1).join(", ")} or ${nouns.at(-1) ?? ""}`;
}

/**
 * Whether a kind of rule can let anybody in, where these are the providers
 * people sign in with. An address is every provider's, so its rule always can.
 */
export function ruleKindWorks(kind: RuleKind, providers: ReadonlyArray<{ id: string }>): boolean {
  const needs = ruleKindSignIns[kind];
  return needs === null || providers.some((provider) => provider.id === needs.id);
}

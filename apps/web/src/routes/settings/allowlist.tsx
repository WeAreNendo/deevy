import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsRow } from "@/components/settings-page";
import { orpc } from "@/lib/orpc.ts";
import { cn } from "@/lib/utils";

const kindLabels = {
  email_domain: "Email domain",
  github_org: "GitHub organization",
  gitlab_group: "GitLab group",
} as const;

/** What the value field asks for, and what it shows as an example, per kind. */
const valueFields = {
  email_domain: { label: "Domain", placeholder: "example.com" },
  github_org: { label: "Organization login", placeholder: "acme" },
  gitlab_group: { label: "Group path", placeholder: "acme/platform" },
} as const;

/** The word a chip wears so a bare value says which namespace it is in. */
const kindPrefixes = {
  email_domain: null,
  github_org: "org",
  gitlab_group: "group",
} as const;

/**
 * The sign-in a kind of rule is decided by. A GitHub organization rule asks
 * the GitHub account somebody signed in with which organizations it is in, and
 * a GitLab group rule their GitLab account, so where nobody signs in with that
 * provider the rule lets nobody in — deevy Cloud has no GitLab sign-in. The
 * server refuses such a rule too (`allowlistRuleSignIn` in packages/core).
 */
const kindSignIns = {
  email_domain: null,
  github_org: { id: "github", label: "GitHub" },
  gitlab_group: { id: "gitlab", label: "GitLab" },
} as const;

type RuleKind = keyof typeof kindLabels;
const ruleKinds = Object.keys(kindLabels) as RuleKind[];

/**
 * M1 admits teammates by rule rather than by invitation: any sign-in matching a
 * rule joins the Workspace as a Member. A row on Workspace › General rather than
 * a page of its own — who may join is a fact about the Workspace (Matt,
 * 2026-09-07) — and the rules are chips rather than a table: nearly every rule
 * is one domain, and a three-control form standing open for it was more page
 * than the fact deserved. The form is behind Add rule.
 */
export function AllowlistRow() {
  const queryClient = useQueryClient();
  const rules = useQuery(orpc.allowlist.list.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.allowlist.key() });

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<RuleKind>("email_domain");
  const [value, setValue] = useState("");

  const add = useMutation(
    orpc.allowlist.add.mutationOptions({
      onSuccess: async () => {
        setValue("");
        setAdding(false);
        await refresh();
      },
    }),
  );
  const remove = useMutation(orpc.allowlist.remove.mutationOptions({ onSuccess: refresh }));
  const failed = add.error ?? remove.error;
  const listed = rules.data?.rules ?? [];

  // The providers this deployment signs in with, as the sign-in page draws
  // them. A kind is offered only beside its provider's button; a rule saved
  // before that provider went away stays listed, and says it lets nobody in.
  const health = useQuery(orpc.health.ping.queryOptions());
  const signsIn = new Set((health.data?.providers ?? []).map((provider) => provider.id));
  const offered = (kind: RuleKind) => {
    const needs = kindSignIns[kind];
    return needs === null || signsIn.has(needs.id);
  };
  const kinds = ruleKinds.filter(offered);
  const strandedRules = health.isSuccess ? listed.filter((rule) => !offered(rule.kind)) : [];
  const stranded = new Set(strandedRules.map((rule) => rule.id));

  return (
    <SettingsRow
      label="Who may join"
      hint={
        listed.length === 0 && !rules.isPending
          ? "Add a rule to let your team sign in — anyone whose account matches joins automatically. Until then, you're the only one who can get in."
          : "Anyone signing in with an account that matches one of these joins your Workspace automatically."
      }
      below={
        adding ? (
          <form
            // Stacked until the row is wide enough for a line of fields: side by
            // side in 340px the domain shrank to a sliver and Cancel fell off it.
            className="flex flex-col gap-3 rounded-md border bg-card p-3 @md:flex-row @md:flex-wrap @md:items-end"
            onSubmit={(submitted) => {
              submitted.preventDefault();
              if (value.trim()) add.mutate({ kind, value: value.trim() });
            }}
          >
            <div className="flex flex-col gap-2 @md:w-48">
              <Label htmlFor="rule-kind">Match on</Label>
              <Select value={kind} onValueChange={(next) => setKind(next as RuleKind)}>
                <SelectTrigger id="rule-kind" className="w-full">
                  <SelectValue>{(selected: RuleKind) => kindLabels[selected]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {kinds.map((one) => (
                      <SelectItem key={one} value={one}>
                        {kindLabels[one]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 @md:min-w-48 @md:flex-1">
              <Label htmlFor="rule-value">{valueFields[kind].label}</Label>
              <Input
                id="rule-value"
                value={value}
                autoFocus
                placeholder={valueFields[kind].placeholder}
                onChange={(changed) => setValue(changed.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={add.isPending || !value.trim()}>
                Add rule
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setValue("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-2 @lg:justify-end">
        {listed.map((rule) => (
          <span
            key={rule.id}
            // A rule that lets nobody in is still the admin's to remove, so it
            // stays a chip, drawn faint and pointing at the line that says why.
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border pr-1 pl-2.5 font-mono text-xs",
              stranded.has(rule.id) && "border-dashed text-muted-foreground",
            )}
            aria-describedby={stranded.has(rule.id) ? `stranded-${rule.id}` : undefined}
          >
            {kindPrefixes[rule.kind] ? (
              <span className="font-sans text-muted-foreground">{kindPrefixes[rule.kind]}</span>
            ) : null}
            {rule.value}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Stop allowing ${rule.value}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate({ ruleId: rule.id })}
            >
              <X aria-hidden />
            </Button>
          </span>
        ))}
        {rules.isPending ? <span className="text-sm text-muted-foreground">Loading…</span> : null}
        {!adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add rule
          </Button>
        ) : null}
      </div>

      {strandedRules.map((rule) => {
        const needs = kindSignIns[rule.kind];
        return needs ? (
          <p key={rule.id} id={`stranded-${rule.id}`} className="text-sm text-muted-foreground">
            {kindLabels[rule.kind]} {rule.value} lets nobody in until people can sign in here with{" "}
            {needs.label}.
          </p>
        ) : null;
      })}
      {failed ? <p className="text-sm text-destructive">{failed.message}</p> : null}
      {rules.isError ? (
        <p className="text-sm text-destructive">Could not load it: {rules.error.message}</p>
      ) : null}
    </SettingsRow>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConnectAgent } from "@/components/connect-agent";
import { MemberChip } from "@/components/member-chip";
import { RunStatus, type RunStatusValue } from "@/components/run-status";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/lib/orpc";

/**
 * The intervals a schedule offers. Anything finer than a quarter of an hour is
 * a poll, not a schedule, and the sweep only runs once a minute anyway.
 */
const NEVER = "never";
const intervals = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Hourly" },
  { minutes: 240, label: "Every 4 hours" },
  { minutes: 1440, label: "Daily" },
];

/**
 * One Agent: who answers for it, the Projects it may see, the keys it reaches
 * deevy with, how often it wakes, and what it has done lately. An Agent starts
 * able to see nothing and reach nothing, so this page is where it is given
 * both (ADR-0004); its Sponsor can be changed here by an admin (ADR-0001).
 */
export function AgentPage({ memberId }: { memberId: string }) {
  const queryClient = useQueryClient();
  const agents = useQuery(orpc.agents.list.queryOptions({ input: {} }));
  const me = useQuery(orpc.me.get.queryOptions());
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.agents.key() });
    await queryClient.invalidateQueries({ queryKey: orpc.members.key() });
  };
  const update = useMutation(orpc.agents.update.mutationOptions({ onSuccess: refresh }));
  const suspend = useMutation(orpc.agents.suspend.mutationOptions({ onSuccess: refresh }));
  const reinstate = useMutation(orpc.agents.reinstate.mutationOptions({ onSuccess: refresh }));

  if (agents.isPending) return <Skeleton className="h-40 w-full" />;
  if (agents.isError) {
    return <p className="text-destructive">Could not load the Agent: {agents.error.message}</p>;
  }
  const agent = agents.data.agents.find((row) => row.id === memberId);
  if (!agent) return <p className="text-muted-foreground">No such Agent.</p>;
  const admin = me.data?.member?.role === "admin";

  return (
    <SettingsPage
      title={
        <MemberChip
          member={{
            id: agent.id,
            kind: "agent",
            handle: agent.handle,
            suspendedAt: agent.suspendedAt,
            user: agent.user,
          }}
          size="lg"
          showHandle
        />
      }
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            Sponsored by{" "}
            <span className="text-foreground">{agent.sponsor?.user.name ?? "nobody"}</span>
          </span>
          {agent.suspendedAt ? <Badge variant="outline">Suspended</Badge> : null}
        </span>
      }
      actions={
        admin ? <SponsorPicker memberId={memberId} current={agent.sponsor?.id ?? null} /> : null
      }
    >
      <Grants memberId={memberId} onChanged={refresh} />
      <Keys memberId={memberId} onChanged={refresh} />
      <Connect />

      <SettingsSection title="Schedule">
        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-schedule">Wake</Label>
          {/* shadcn's Base UI Select, as its docs compose it: trigger and value, then a group of items. */}
          <Select
            value={agent.scheduleMinutes === null ? NEVER : String(agent.scheduleMinutes)}
            disabled={update.isPending}
            onValueChange={(next) => {
              if (next === null) return;
              update.mutate({ memberId, scheduleMinutes: next === NEVER ? null : Number(next) });
            }}
          >
            <SelectTrigger id="agent-schedule" className="w-56">
              <SelectValue>
                {(selected: string) =>
                  selected === NEVER
                    ? "Never"
                    : (intervals.find((interval) => String(interval.minutes) === selected)?.label ??
                      selected)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={NEVER}>Never</SelectItem>
                {intervals.map((interval) => (
                  <SelectItem key={interval.minutes} value={String(interval.minutes)}>
                    {interval.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {update.error ? <p className="text-sm text-destructive">{update.error.message}</p> : null}
      </SettingsSection>

      <RecentRuns memberId={memberId} />

      <SettingsSection tone="danger" title={agent.suspendedAt ? "Suspended" : "Suspend this Agent"}>
        <div>
          {agent.suspendedAt ? (
            <Button
              variant="outline"
              disabled={reinstate.isPending}
              onClick={() => reinstate.mutate({ memberId })}
            >
              Reinstate
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={suspend.isPending}
              onClick={() => suspend.mutate({ memberId })}
            >
              Suspend
            </Button>
          )}
        </div>
        {(suspend.error ?? reinstate.error) ? (
          <p className="text-sm text-destructive">{(suspend.error ?? reinstate.error)?.message}</p>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}

/** An admin hands an Agent to another Human — the one hop of accountability (ADR-0001). */
function SponsorPicker({ memberId, current }: { memberId: string; current: string | null }) {
  const queryClient = useQueryClient();
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const setSponsor = useMutation(
    orpc.agents.setSponsor.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.agents.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.members.key() });
      },
    }),
  );
  const humans = (members.data?.members ?? []).filter(
    (member) => member.kind === "human" && !member.suspendedAt,
  );
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="agent-sponsor" className="text-xs text-muted-foreground">
        Sponsor
      </Label>
      {/* A combobox, typed into: the Workspace's Humans, the current one shown. */}
      <Combobox
        items={humans}
        value={humans.find((human) => human.id === current) ?? null}
        onValueChange={(next) => {
          const human = next as (typeof humans)[number] | null;
          if (human && human.id !== current) {
            setSponsor.mutate({ memberId, sponsorMemberId: human.id });
          }
        }}
        itemToStringLabel={(human: (typeof humans)[number]) => human.user.name}
        isItemEqualToValue={(a: (typeof humans)[number], b: (typeof humans)[number]) =>
          a.id === b.id
        }
        disabled={setSponsor.isPending}
      >
        <ComboboxInput
          id="agent-sponsor"
          aria-label="Change Sponsor"
          className="w-56"
          placeholder={current ? undefined : "Nobody yet; name a Human…"}
        />
        <ComboboxContent>
          <ComboboxEmpty>No Human by that name.</ComboboxEmpty>
          <ComboboxList>
            {(human: (typeof humans)[number]) => (
              <ComboboxItem key={human.id} value={human}>
                {human.user.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {setSponsor.error ? (
        <p className="text-xs text-destructive">{setSponsor.error.message}</p>
      ) : null}
    </div>
  );
}

/** An ungranted Project does not exist to an Agent, so this is its whole world. */
function Grants({ memberId, onChanged }: { memberId: string; onChanged: () => Promise<void> }) {
  const granted = useQuery(orpc.agents.grants.list.queryOptions({ input: { memberId } }));
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const add = useMutation(orpc.agents.grants.add.mutationOptions({ onSuccess: onChanged }));
  const remove = useMutation(orpc.agents.grants.remove.mutationOptions({ onSuccess: onChanged }));

  const mine = granted.data?.projects ?? [];
  const ungranted = (projects.data?.projects ?? []).filter(
    (project) => !mine.some((row) => row.id === project.id),
  );

  return (
    <SettingsSection aria-label="Projects" title="Projects">
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet, so it can see nothing.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {mine.map((project) => (
            <li
              key={project.id}
              className="flex items-center gap-1 rounded-md border bg-background px-2 py-1"
            >
              <span className="font-mono text-xs text-muted-foreground">{project.slug}</span>
              <span className="text-sm">{project.name}</span>
              <Button
                size="xs"
                variant="destructive"
                aria-label={`Revoke ${project.slug}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ memberId, projectId: project.id })}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="grant-project">Grant a Project</Label>
        {/* A combobox over the Projects not yet granted; choosing one grants it. */}
        <Combobox
          items={ungranted}
          value={null}
          onValueChange={(next) => {
            const project = next as (typeof ungranted)[number] | null;
            if (project) add.mutate({ memberId, projectId: project.id });
          }}
          itemToStringLabel={(project: (typeof ungranted)[number]) =>
            `${project.slug} — ${project.name}`
          }
          isItemEqualToValue={(a: (typeof ungranted)[number], b: (typeof ungranted)[number]) =>
            a.id === b.id
          }
          disabled={add.isPending || ungranted.length === 0}
        >
          <ComboboxInput
            id="grant-project"
            className="w-72"
            placeholder={ungranted.length === 0 ? "Every Project is granted" : "Choose a Project…"}
          />
          <ComboboxContent>
            <ComboboxEmpty>No Project matches.</ComboboxEmpty>
            <ComboboxList>
              {(project: (typeof ungranted)[number]) => (
                <ComboboxItem key={project.id} value={project}>
                  <span className="font-mono text-xs text-muted-foreground">{project.slug}</span>
                  {project.name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      {(add.error ?? remove.error) ? (
        <p className="text-sm text-destructive">{(add.error ?? remove.error)?.message}</p>
      ) : null}
    </SettingsSection>
  );
}

/**
 * Keys are shown once, at the moment they are minted, because deevy stores a
 * hash and cannot show one again. Everything else here is a stub of one.
 */
function Keys({ memberId, onChanged }: { memberId: string; onChanged: () => Promise<void> }) {
  const keys = useQuery(orpc.agents.keys.list.queryOptions({ input: { memberId } }));
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);

  const issue = useMutation(
    orpc.agents.keys.issue.mutationOptions({
      onSuccess: async (issued: { key: string }) => {
        setMinted(issued.key);
        setName("");
        await onChanged();
      },
    }),
  );
  const revoke = useMutation(orpc.agents.keys.revoke.mutationOptions({ onSuccess: onChanged }));

  return (
    <SettingsSection aria-label="API keys" title="API keys">
      {minted ? (
        <div className="flex flex-col gap-3 rounded-md border border-gate/50 bg-gate/10 p-3">
          <p className="text-sm font-medium">Copy this now: it is the only time you will see it.</p>
          <code className="overflow-x-auto rounded bg-background px-2 py-1 font-mono text-sm">
            {minted}
          </code>
          {/* And what it is for, while deevy can still write it into the command. */}
          <ConnectAgent issuedKey={minted} />
        </div>
      ) : null}

      {(keys.data?.keys ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No keys, so it cannot reach deevy yet.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {(keys.data?.keys ?? []).map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{key.name ?? "unnamed"}</span>
                <code className="font-mono text-xs text-muted-foreground">{key.start}…</code>
                {key.enabled ? null : <Badge variant="outline">Disabled</Badge>}
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ memberId, keyId: key.id })}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          issue.mutate({ memberId, name: name.trim() });
        }}
      >
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="key-name">Key name</Label>
          <Input
            id="key-name"
            value={name}
            onChange={(changed) => setName(changed.target.value)}
            placeholder="ci, laptop, the machine it runs on"
          />
        </div>
        <Button type="submit" disabled={issue.isPending || !name.trim()}>
          Issue
        </Button>
      </form>
      {(issue.error ?? revoke.error) ? (
        <p className="text-sm text-destructive">{(issue.error ?? revoke.error)?.message}</p>
      ) : null}
    </SettingsSection>
  );
}

/**
 * Where an Agent's key is used: one tab per coding agent, each with the file
 * or the command that points it at this deevy (`components/connect-agent.tsx`).
 * It sits on the Agent's own page and not on the list, because connecting is
 * something you do to one Agent with one key. With no key in hand it can only
 * name one, so the same block appears beside a key the moment it is issued.
 */
function Connect() {
  return (
    <SettingsSection
      aria-label="Connect an Agent"
      title="Connect an Agent"
      description="Point a coding agent at this deevy and hand it the key. Every tool speaks MCP; only where the configuration lives differs."
    >
      <ConnectAgent />
    </SettingsSection>
  );
}

/** The last ten Runs, so whether the Agent is working is a glance, not a query. */
function RecentRuns({ memberId }: { memberId: string }) {
  const runs = useQuery(
    orpc.runs.list.queryOptions({ input: { agentMemberId: memberId, limit: 10 } }),
  );
  const rows = (runs.data?.runs ?? []) as Array<{
    id: string;
    status: string;
    issueKey?: string;
    summary: string | null;
    createdAt: string | Date;
  }>;
  return (
    <SettingsSection title="Recent Runs">
      {runs.isPending ? <Skeleton className="h-16 w-full" /> : null}
      {runs.data && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Runs yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y">
          {rows.map((run) => (
            <li key={run.id} className="flex items-center gap-3 py-2 text-sm">
              <RunStatus status={run.status as RunStatusValue} />
              {run.issueKey ? <span className="font-mono text-xs">{run.issueKey}</span> : null}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {run.summary ?? ""}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(run.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsSection>
  );
}

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage, SettingsRow } from "@/components/settings-page";
import { AllowlistRow } from "@/routes/settings/allowlist";
import { InvitationsRow } from "@/routes/settings/invitations";
import { useAutosave } from "@/lib/autosave";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

/**
 * The front door of Settings. It used to be two forms and nothing else — the
 * page was called Workspace and never showed you one. Now it opens with the
 * Workspace itself (its mark, its name edited in place, its address, its age and
 * its size), then every setting as a row that saves itself, with one strip on
 * top naming what this instance has not set up yet (Matt, 2026-09-07).
 */
export function WorkspacePage() {
  const me = useQuery(orpc.me.get.queryOptions());
  const admin = me.data?.member?.role === "admin";

  return (
    <SettingsPage title="Workspace">
      {/* Only an admin can act on any of it, and `channels.list` is an
          admin-only operation besides. */}
      {admin ? <SetUp /> : null}
      <Identity canRename={admin} />
      {admin ? (
        <div className="flex flex-col">
          <AllowlistRow />
          <InvitationsRow />
          <DelegationRow />
        </div>
      ) : null}
    </SettingsPage>
  );
}

/** The Workspace as an object: what it is called, where it lives, how big it got. */
function Identity({ canRename }: { canRename: boolean }) {
  const queryClient = useQueryClient();
  const workspace = useQuery(orpc.workspace.get.queryOptions());
  // Both are already in cache: the shell reads them for the sidebar.
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));

  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const update = useMutation(
    orpc.workspace.update.mutationOptions({
      // The sidebar's name comes from me.get, so both re-read.
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.workspace.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.me.key() }),
        ]),
    }),
  );
  const autosave = useAutosave<string>((name) => update.mutateAsync({ name }));

  if (workspace.isPending) return <Skeleton className="h-28 w-full" />;
  if (workspace.isError) {
    return (
      <p className="text-destructive">Could not load the Workspace: {workspace.error.message}</p>
    );
  }

  const shown = draft ?? workspace.data.name;
  const save = () => {
    const next = shown.trim();
    if (!next) {
      setRefused("A Workspace needs a name");
      setDraft(null);
      return;
    }
    setRefused(null);
    if (next !== workspace.data.name) void autosave.saveNow(next);
    else setDraft(null);
  };

  const madeOn = new Date(workspace.data.createdAt);
  const made = Number.isNaN(madeOn.getTime())
    ? null
    : madeOn.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  const humans = (members.data?.members ?? []).filter((member) => member.kind !== "agent").length;
  const agents = (members.data?.members ?? []).filter((member) => member.kind === "agent").length;
  const counts = [
    { n: humans, of: humans === 1 ? "Human" : "Humans" },
    { n: agents, of: agents === 1 ? "Agent" : "Agents" },
    {
      n: projects.data?.projects.length ?? 0,
      of: (projects.data?.projects.length ?? 0) === 1 ? "Project" : "Projects",
    },
  ];

  return (
    <section aria-label="This Workspace" className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary font-mono text-lg font-semibold text-primary-foreground"
        >
          {workspace.data.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Edited where it is read. A field that looks like the heading it sets,
              with its edges showing on hover and focus so it is still findable. */}
          <Input
            id="workspace-name"
            aria-label="Name"
            value={shown}
            readOnly={!canRename}
            aria-invalid={refused ? true : undefined}
            className={cn(
              "h-auto max-w-sm border-transparent bg-transparent px-1.5 py-0.5 text-xl font-semibold tracking-tight -ml-1.5",
              canRename && "hover:border-input hover:bg-card",
              !canRename && "cursor-default",
            )}
            onChange={(changed) => {
              setRefused(null);
              setDraft(changed.target.value);
            }}
            onBlur={save}
            onKeyDown={(pressed) => {
              if (pressed.key === "Enter") {
                pressed.preventDefault();
                pressed.currentTarget.blur();
              }
            }}
          />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono">@{workspace.data.slug}</span>
            {made ? (
              <>
                <span aria-hidden>·</span>
                <span>made {made}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {refused ? <p className="text-sm text-destructive">{refused}</p> : null}
      <p role="status" className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
        {autosave.status === "saving" ? "Saving…" : null}
        {autosave.status === "saved" ? "Saved" : null}
        {autosave.status === "error" ? (
          <>
            <span className="text-destructive">{autosave.error}</span>
            <Button type="button" variant="outline" size="xs" onClick={autosave.retry}>
              Retry
            </Button>
          </>
        ) : null}
        {autosave.status === "idle" && canRename
          ? "Changes save automatically when you click away."
          : null}
      </p>

      {/* Ruled apart, not just spaced: four numbers in a row with nothing between
          them read as one number with four parts. */}
      <ul className="flex flex-wrap items-center gap-y-3">
        {counts.map((count) => (
          <li
            key={count.of}
            className="flex flex-col border-l px-5 first:border-l-0 first:pl-0 last:pr-0"
          >
            <span className="text-lg font-semibold tabular-nums">{count.n}</span>
            <span className="text-xs text-muted-foreground">{count.of}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this instance has not set up yet, and where to fix it. Every check is a
 * list the app already has, so the strip costs no operation of its own — and it
 * is gone the moment there is nothing left on it, which is the whole point: a
 * checklist of ticks is furniture.
 */
function SetUp() {
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const agents = useQuery(orpc.agents.list.queryOptions({ input: {} }));
  const channels = useQuery(orpc.channels.list.queryOptions({ input: {} }));

  const checks = [
    {
      done: (projects.data?.projects.length ?? 0) > 0,
      todo: "Create a Project so your Issues have somewhere to live",
      action: { label: "New Project", to: "/settings/projects" },
    },
    {
      done: (agents.data?.agents.length ?? 0) > 0,
      todo: "Add an Agent so it can pick up work alongside your team",
      action: { label: "Add one", to: "/settings/agents" },
    },
    {
      done: (channels.data?.channels.length ?? 0) > 0,
      todo: "Connect a Channel to get Notifications in Slack",
      action: { label: "Connect", to: "/settings/channels" },
    },
  ];

  const loading = [projects, agents, channels].some((query) => query.isPending);
  const left = checks.filter((check) => !check.done);
  // Nothing left to say, or not enough read yet to say it.
  if (loading || left.length === 0) return null;
  const done = checks.length - left.length;

  return (
    <section
      aria-label="Set up"
      className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">Finish setting this Workspace up</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {done} of {checks.length}
        </span>
      </div>
      <ul className="flex flex-col">
        {left.map((check) => (
          <li
            key={check.todo}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-primary/20 py-2 first:border-t-0 first:pt-0"
          >
            <span className="min-w-0 flex-1 text-sm">{check.todo}</span>
            {check.action ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to={check.action.to} />}
              >
                {check.action.label}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One of the three numbers below: a label, a field, and a save on leaving it. */
function Ceiling({
  id,
  label,
  value,
  onSave,
  saving,
}: {
  id: string;
  label: string;
  value: number;
  onSave: (next: number) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        id={id}
        type="number"
        min={1}
        inputMode="numeric"
        className="w-24"
        disabled={saving}
        value={shown}
        onChange={(typed) => setDraft(typed.target.value)}
        onBlur={() => {
          const next = Number(shown);
          setDraft(null);
          if (Number.isInteger(next) && next >= 1 && next !== value) onSave(next);
        }}
      />
    </label>
  );
}

/**
 * What an Agent may not go past when it cuts work into sub-issues
 * (docs/plans/sub-issue-delegation.md). An Agent that decides a task has forty
 * parts will open forty Issues and start forty Runs, and these are the numbers
 * that say it may not. They are about Agents: a Human is never stopped by them.
 */
export function DelegationRow() {
  const queryClient = useQueryClient();
  const workspace = useQuery(orpc.workspace.get.queryOptions());
  const update = useMutation(
    orpc.workspace.update.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.workspace.key() }),
    }),
  );

  return (
    <SettingsRow
      label="How far an Agent may split work"
      hint="An Agent can open sub-issues and hand them to other Agents. These are the limits on that: past any of them it is refused, and the refusal is in the Workspace's log. They do not apply to you."
    >
      {workspace.isPending ? (
        <Skeleton className="h-9 w-72" />
      ) : workspace.isError ? (
        <p className="text-sm text-destructive">{workspace.error.message}</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Ceiling
            id="max-children"
            label="Sub-issues each"
            value={workspace.data.maxChildrenPerIssue}
            saving={update.isPending}
            onSave={(maxChildrenPerIssue) => update.mutate({ maxChildrenPerIssue })}
          />
          <Ceiling
            id="max-depth"
            label="Levels deep"
            value={workspace.data.maxDelegationDepth}
            saving={update.isPending}
            onSave={(maxDelegationDepth) => update.mutate({ maxDelegationDepth })}
          />
          <Ceiling
            id="max-open"
            label="Open in one tree"
            value={workspace.data.maxOpenDescendants}
            saving={update.isPending}
            onSave={(maxOpenDescendants) => update.mutate({ maxOpenDescendants })}
          />
        </div>
      )}
      {update.error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {update.error.message}
        </p>
      ) : null}
    </SettingsRow>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bot } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConnectAgent } from "@/components/connect-agent";
import { MemberChip } from "@/components/member-chip";
import { SettingsPage } from "@/components/settings-page";
import { orpc } from "@/lib/orpc.ts";

/** "1 Project", "3 Projects", or the fact that it can see nothing yet. */
function grantSummary(count: number): string {
  if (count === 0) return "No Projects";
  return count === 1 ? "1 Project" : `${count} Projects`;
}

/**
 * The Agents in this Workspace and the Human accountable for each (ADR-0001).
 * An Agent sees only the Projects it was granted, so the count is the first
 * thing worth showing next to its Sponsor.
 */
export function AgentsPage() {
  const queryClient = useQueryClient();
  const agents = useQuery(orpc.agents.list.queryOptions({ input: {} }));
  const [creating, setCreating] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.agents.key() });
    await queryClient.invalidateQueries({ queryKey: orpc.members.key() });
  };
  const suspend = useMutation(orpc.agents.suspend.mutationOptions({ onSuccess: refresh }));
  const reinstate = useMutation(orpc.agents.reinstate.mutationOptions({ onSuccess: refresh }));
  const failed = suspend.error ?? reinstate.error;

  if (agents.isError) {
    return <p className="text-destructive">Could not load Agents: {agents.error.message}</p>;
  }

  type AgentRow = NonNullable<typeof agents.data>["agents"][number];
  const columns: DataColumn<AgentRow>[] = [
    {
      id: "agent",
      header: "Agent",
      cell: (agent) => (
        <Link
          to="/settings/agents/$memberId"
          params={{ memberId: agent.id }}
          className="underline-offset-4 hover:underline"
        >
          <MemberChip
            member={{
              id: agent.id,
              kind: "agent",
              handle: agent.handle,
              suspendedAt: agent.suspendedAt,
              user: agent.user,
            }}
            showHandle
          />
        </Link>
      ),
      sortValue: (agent) => agent.user.name,
      className: "w-full",
    },
    {
      id: "sponsor",
      header: "Sponsor",
      cell: (agent) =>
        agent.sponsor ? (
          <MemberChip
            member={{ id: agent.sponsor.id, kind: "human", user: agent.sponsor.user }}
            size="xs"
          />
        ) : (
          <span className="text-destructive">No Sponsor</span>
        ),
      sortValue: (agent) => agent.sponsor?.user.name ?? "",
    },
    {
      id: "grants",
      header: "Can see",
      cell: (agent) => (
        <span className="text-muted-foreground">
          {grantSummary(agent.grantedProjectIds.length)}
        </span>
      ),
      sortValue: (agent) => agent.grantedProjectIds.length,
    },
    {
      id: "status",
      header: "Status",
      cell: (agent) => (
        <span className="flex items-center justify-end gap-2">
          {agent.suspendedAt ? (
            <>
              <Badge variant="outline">Suspended</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={reinstate.isPending}
                onClick={() => reinstate.mutate({ memberId: agent.id })}
              >
                Reinstate
              </Button>
            </>
          ) : (
            <>
              <Badge variant="secondary">Active</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={suspend.isPending}
                onClick={() => suspend.mutate({ memberId: agent.id })}
              >
                Suspend
              </Button>
            </>
          )}
        </span>
      ),
      className: "text-right",
      headerClassName: "text-right",
    },
  ];

  return (
    <SettingsPage
      title="Agents"
      actions={<Button onClick={() => setCreating(true)}>New Agent</Button>}
    >
      <NewAgent open={creating} onOpenChange={setCreating} />
      {failed ? <p className="text-sm text-destructive">{failed.message}</p> : null}

      <DataTable
        aria-label="Agents"
        columns={columns}
        rows={agents.data?.agents ?? []}
        getRowId={(agent) => agent.id}
        loading={agents.isPending}
        empty={{
          icon: Bot,
          title: "No Agents yet",
          description:
            "Add your first Agent to give it an identity, an API key and Projects to work in.",
        }}
      />
    </SettingsPage>
  );
}

/**
 * Creating an Agent makes the Human who did it accountable for it (ADR-0001),
 * so there is no Sponsor to choose here. The handle is slugged from the name
 * when it is left out.
 *
 * The Agent is created with its first key, and this dialog is the only place
 * that key is ever readable — the same bargain the invitation link makes, for
 * the same reason: deevy keeps a hash and cannot show one twice.
 */
function NewAgent({ open, onOpenChange }: { open: boolean; onOpenChange: (to: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; key: string | null } | null>(
    null,
  );

  const close = (to: boolean) => {
    if (!to) {
      setName("");
      setHandle("");
      setCreated(null);
    }
    onOpenChange(to);
  };

  const create = useMutation(
    orpc.agents.create.mutationOptions({
      onSuccess: async (agent: {
        id: string;
        user: { name: string };
        key: { key: string } | null;
      }) => {
        setCreated({ id: agent.id, name: agent.user.name, key: agent.key?.key ?? null });
        await queryClient.invalidateQueries({ queryKey: orpc.agents.key() });
      },
    }),
  );

  if (created) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{created.name} is ready</DialogTitle>
            <DialogDescription>
              {created.key
                ? "Its first key is below. Copy it now: this is the only time you will see it."
                : "Grant it a Project to work in, and issue it a key from its own page."}
            </DialogDescription>
          </DialogHeader>
          {created.key ? (
            <div className="flex flex-col gap-3 rounded-md border border-gate/50 bg-gate/10 p-3">
              <code className="overflow-x-auto rounded bg-background px-2 py-1 font-mono text-sm">
                {created.key}
              </code>
              {/* The command it is for, with the key already in it: after this
                  dialog closes there is nothing left to fill it in with. */}
              <ConnectAgent issuedKey={created.key} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Done
            </Button>
            {/* A real link dressed as a button, the way the not-found page's ways out are. */}
            <Link
              to="/settings/agents/$memberId"
              params={{ memberId: created.id }}
              onClick={() => close(false)}
              className={buttonVariants()}
            >
              Open {created.name}
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
          <DialogDescription>
            You&apos;ll be its Sponsor. It is created with its first API key, which you will see
            once; then grant it a Project to work in.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            create.mutate({ name: name.trim(), handle: handle.trim() || null });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(changed) => setName(changed.target.value)}
              placeholder="Planner"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-handle">Handle</Label>
            <Input
              id="agent-handle"
              value={handle}
              onChange={(changed) => setHandle(changed.target.value)}
              placeholder="Left out, it is made from the name"
            />
          </div>
          {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsSection } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/orpc";
import { providerLabel } from "@/lib/providers";

/** Base UI wants a real value for "nobody", so the sentinel is a constant. */
const NOBODY = "__nobody";

/**
 * What a Project is bound to (ADR-0024).
 *
 * A Project holds no work: it names the tool and the container its records
 * come from, which Agent gets a record nobody named, and how a record names an
 * Agent. That is the whole of what a Project is now, so this is the whole of
 * what there is to set. What deevy says back on a record is a Gate and its
 * Ruling, always, so there is no setting for it (docs/plans/simplify.md,
 * slice 4).
 *
 * The tracker itself is stated and not offered: moving a Project to another
 * container would orphan every projection under it, which is a new Project
 * rather than an edit.
 */
export function ProjectBinding({ projectSlug }: { projectSlug: string }) {
  const client = useQueryClient();
  const project = useQuery(orpc.projects.get.queryOptions({ input: { slug: projectSlug } }));
  const sockets = useQuery(orpc.sockets.list.queryOptions({ input: {} }));
  const agents = useQuery(orpc.agents.list.queryOptions({ input: {} }));

  const update = useMutation({
    ...orpc.projects.update.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.projects.key() });
        // Choosing a default Agent grants it the Project, so its grants moved too.
        await client.invalidateQueries({ queryKey: orpc.agents.key() });
      },
    }),
    // One at a time, in the order they were made: the routing label and the
    // switch each write the whole of `routing`, so two in flight could land
    // the wrong way round and put back what the other just changed.
    scope: { id: `project:${projectSlug}` },
  });
  // The routing as this screen last set it, which both controls write from,
  // taken afresh whenever the Project read back says something new: neither
  // control puts back a value saved elsewhere, nor one the server has yet to
  // read back to it.
  const saved = project.data?.routing;
  const [routing, setRouting] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (saved && (saved.labelPrefix !== seen?.labelPrefix || saved.mention !== seen?.mention)) {
    setSeen(saved);
    setRouting(saved);
  }

  if (project.isPending) return null;
  if (project.isError) return <p className="text-sm text-destructive">{project.error.message}</p>;

  const bound = project.data;
  const tracker = sockets.data?.sockets.find((one) => one.id === bound.trackerSocketId);
  // What a Human types to name deevy in that tool, with or without its `@`.
  const mentionAs = tracker?.identity.mentionHandle.replace(/^@/, "") || "deevy";
  // A scope is whatever its provider decided, so what a screen reads out of one
  // it reads carefully (ADR-0024).
  const text = (scope: unknown, key: string): string => {
    const found = (scope ?? {}) as Record<string, unknown>;
    return typeof found[key] === "string" ? found[key] : "";
  };
  const container = text(bound.trackerScope, "scopeKey");

  return (
    <SettingsSection
      aria-label="Binding"
      title="Binding"
      description="Where this Project's work lives, and who deevy hands it to."
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Records come from</span>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{providerLabel(tracker?.provider)}</Badge>
          <span>{tracker?.name ?? "a Socket that is gone"}</span>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">{container}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          A Project is the container its records come from, so this cannot be moved. Bind another
          container as its own Project.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-default-agent">Default Agent</Label>
        <Select
          value={bound.defaultAgentMemberId ?? NOBODY}
          onValueChange={(next) =>
            update.mutate({
              slug: projectSlug,
              defaultAgentMemberId: next === NOBODY ? null : (next as string),
            })
          }
        >
          <SelectTrigger id="project-default-agent" aria-label="Default Agent" className="w-72">
            <SelectValue>
              {(selected: string) =>
                (agents.data?.agents ?? []).find((agent) => agent.id === selected)?.user.name ??
                "Nobody"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={NOBODY}>Nobody</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Agents</SelectLabel>
              {(agents.data?.agents ?? []).map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.user.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Who gets an open record no label and no mention named, and choosing an Agent here lets it
          see this Project. GitHub cannot assign an App, so this and the routing label are how a
          record reaches an Agent.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-label-prefix">Routing label</Label>
          <Input
            id="project-label-prefix"
            className="w-44"
            value={(routing ?? bound.routing).labelPrefix}
            placeholder="agent:"
            onChange={(typed) =>
              setRouting({ ...(routing ?? bound.routing), labelPrefix: typed.target.value })
            }
            onBlur={(left) => {
              const next = left.target.value.trim();
              if (next !== bound.routing.labelPrefix) {
                update.mutate({
                  slug: projectSlug,
                  routing: { labelPrefix: next, mention: (routing ?? bound.routing).mention },
                });
              }
            }}
          />
          <span className="text-xs text-muted-foreground">
            A record labelled <code className="font-mono">{bound.routing.labelPrefix}planner</code>{" "}
            goes to that Agent.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex h-8 items-center gap-3 text-sm">
            {/* Named by the label around it, which Base UI points it at. */}
            <Switch
              checked={(routing ?? bound.routing).mention}
              onCheckedChange={(checked) => {
                const next = {
                  labelPrefix: (routing ?? bound.routing).labelPrefix.trim(),
                  mention: checked === true,
                };
                setRouting(next);
                update.mutate({ slug: projectSlug, routing: next });
              }}
            />
            Route by mention
          </label>
          <span className="text-xs text-muted-foreground">
            A comment such as <code className="font-mono">@{mentionAs} planner</code> hands the
            record to that Agent. Off, a comment hands it to nobody: a label, an assignment in the
            tool or the Default Agent still does.
          </span>
        </div>
      </div>

      {update.error ? <p className="text-sm text-destructive">{update.error.message}</p> : null}
    </SettingsSection>
  );
}

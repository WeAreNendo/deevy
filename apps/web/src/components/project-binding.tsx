import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
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
import { orpc } from "@/lib/orpc";
import { providerLabel } from "@/lib/providers";

/** Base UI wants a real value for "nobody", so the sentinel is a constant. */
const NOBODY = "__nobody";
/** And for "nowhere", when a Project keeps its documents in no tool deevy reads. */
const NOWHERE = "__nowhere";

/**
 * What each mirror setting is called. A Base UI trigger shows the value it
 * holds unless told what it is called, which put `gates` on the screen.
 */
const mirrorLabel: Record<string, string> = {
  off: "Nothing",
  gates: "Gates and rulings",
  runs: "Runs as well",
};

/**
 * What a Project is bound to (ADR-0024).
 *
 * A Project holds no work: it names the tool and the container its records
 * come from, the repository its code is in, which Agent gets a record nobody
 * named, and how much deevy says back where the work lives. That is the whole
 * of what a Project is now, so this is the whole of what there is to set.
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

  const update = useMutation(
    orpc.projects.update.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.projects.key() });
      },
    }),
  );

  if (project.isPending) return null;
  if (project.isError) return <p className="text-sm text-destructive">{project.error.message}</p>;

  const bound = project.data;
  const tracker = sockets.data?.sockets.find((one) => one.id === bound.trackerSocketId);
  // A scope is whatever its provider decided, so what a screen reads out of one
  // it reads carefully (ADR-0024).
  const text = (scope: unknown, key: string): string => {
    const found = (scope ?? {}) as Record<string, unknown>;
    return typeof found[key] === "string" ? found[key] : "";
  };
  const container = text(bound.trackerScope, "scopeKey");
  const forgeScope = text(bound.forgeScope, "scopeKey");
  // Only a tool that can read a page is somewhere documents can be read from.
  const readers = (sockets.data?.sockets ?? []).filter(
    (one) => one.capabilities.includes("docs") && one.status === "active",
  );
  const baseBranch = text(bound.forgeScope, "baseBranch");

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
          Who gets an open record no label and no mention named. GitHub cannot assign an App, so
          this and the routing label are how a record reaches an Agent.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-label-prefix">Routing label</Label>
          <Input
            id="project-label-prefix"
            className="w-44"
            defaultValue={bound.routing.labelPrefix}
            placeholder="agent:"
            onBlur={(left) => {
              const next = left.target.value.trim();
              if (next !== bound.routing.labelPrefix) {
                update.mutate({
                  slug: projectSlug,
                  routing: { labelPrefix: next, mention: bound.routing.mention },
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
          <Label htmlFor="project-mirror">Mirror</Label>
          <Select
            value={bound.mirror}
            onValueChange={(next) =>
              update.mutate({ slug: projectSlug, mirror: next as "off" | "gates" | "runs" })
            }
          >
            <SelectTrigger id="project-mirror" aria-label="Mirror" className="w-56">
              <SelectValue>{(selected: string) => mirrorLabel[selected] ?? selected}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(mirrorLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            How much deevy writes back where the work lives.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Code lives in</span>
        {bound.forgeSocketId ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs">{forgeScope}</span>
            {baseBranch ? <Badge variant="outline">{baseBranch}</Badge> : null}
            <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Nowhere yet. An Agent working this Project has no checkout until a repository is bound.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-docs">Documents</Label>
        <Select
          value={bound.docsSocketId ?? NOWHERE}
          onValueChange={(next) =>
            update.mutate({
              slug: projectSlug,
              docs: next === NOWHERE ? null : { socketId: next as string, scope: {} },
            })
          }
        >
          <SelectTrigger id="project-docs" aria-label="Documents" className="w-72">
            <SelectValue>
              {(selected: string) => {
                const reader = readers.find((one) => one.id === selected);
                return reader
                  ? `${reader.name} (${providerLabel(reader.provider)})`
                  : "Nowhere deevy reads";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={NOWHERE}>Nowhere deevy reads</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Tools that hold documents</SelectLabel>
              {readers.map((reader) => (
                <SelectItem key={reader.id} value={reader.id}>
                  {reader.name} ({providerLabel(reader.provider)})
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Where this Project&apos;s plans live. An Agent working it reads a page there when a record
          links one.
        </span>
      </div>

      {update.error ? <p className="text-sm text-destructive">{update.error.message}</p> : null}
    </SettingsSection>
  );
}

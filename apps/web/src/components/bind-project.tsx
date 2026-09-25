import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/lib/orpc";
import { providerLabel } from "@/lib/providers";

/** A handle out of a container's own name: `acme/deevy` becomes `acme-deevy`. */
export function slugFor(scopeKey: string): string {
  return scopeKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Binding a container to a Project (ADR-0024).
 *
 * A Project is not a place work is put any more, so there is nothing to fill
 * in: a tool, a container inside it, and a name. The containers are the tool's
 * own answer rather than a field somebody types, because a typo there is a
 * Project bound to a repository that does not exist. A tool that holds code
 * too — GitHub, GitLab — binds the same container as the Project's code unless
 * told otherwise, because that is nearly always where it is, and a Project
 * with no code bound is one no Agent can push from.
 */
export function BindProject({ onBound }: { onBound: (slug: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [codeHereToo, setCodeHereToo] = useState(true);

  const sockets = useQuery(orpc.sockets.list.queryOptions({ input: {} }));
  const containers = useQuery({
    ...orpc.sockets.containers.queryOptions({ input: { socketId: socketId ?? "" } }),
    enabled: Boolean(socketId),
  });
  const create = useMutation(
    orpc.projects.create.mutationOptions({
      onSuccess: async (project) => {
        setOpen(false);
        setSocketId(null);
        setScopeKey(null);
        setName("");
        setCodeHereToo(true);
        await client.invalidateQueries({ queryKey: orpc.projects.key() });
        onBound(project.slug);
      },
    }),
  );

  const trackers = (sockets.data?.sockets ?? []).filter(
    (socket) => socket.capabilities.includes("tracker") && socket.status === "active",
  );
  const chosen = (containers.data?.containers ?? []).find((one) => one.scopeKey === scopeKey);
  const tool = trackers.find((socket) => socket.id === socketId);
  const holdsCode = tool?.capabilities.includes("forge") ?? false;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Bind a Project
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bind a Project</DialogTitle>
            <DialogDescription>
              A Project is a container in one of your tools, and the Agents that may work it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bind-socket">Tool</Label>
              <Select
                value={socketId ?? ""}
                onValueChange={(next) => {
                  setSocketId(next as string);
                  setScopeKey(null);
                }}
              >
                <SelectTrigger id="bind-socket" aria-label="Tool">
                  {/* Base UI shows the raw value unless told what it is called. */}
                  <SelectValue placeholder="Which tool">
                    {(selected: string) => {
                      const socket = trackers.find((one) => one.id === selected);
                      return socket
                        ? `${socket.name} (${providerLabel(socket.provider)})`
                        : "Which tool";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {trackers.map((socket) => (
                      <SelectItem key={socket.id} value={socket.id}>
                        {socket.name} ({providerLabel(socket.provider)})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {trackers.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Nothing is connected yet. Connect a tool first.
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bind-container">Container</Label>
              <Select
                value={scopeKey ?? ""}
                // Disabled only while there is no tool to ask: a select that
                // goes dead while its answer is in flight loses the click that
                // opened it, and the answer is one round trip away.
                disabled={!socketId}
                onValueChange={(next) => {
                  setScopeKey(next as string);
                  if (!name.trim()) setName(String(next).split("/").at(-1) ?? "");
                }}
              >
                <SelectTrigger id="bind-container" aria-label="Container">
                  <SelectValue
                    placeholder={containers.isPending ? "Asking the tool…" : "Which container"}
                  >
                    {(selected: string) =>
                      (containers.data?.containers ?? []).find((one) => one.scopeKey === selected)
                        ?.name ?? "Which container"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(containers.data?.containers ?? []).map((container) => (
                      <SelectItem key={container.scopeKey} value={container.scopeKey}>
                        {container.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                What the tool itself offers. One container is one Project.
              </span>
            </div>

            {holdsCode ? (
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={codeHereToo}
                  onCheckedChange={(checked) => setCodeHereToo(checked === true)}
                />
                Its code is here too, so its Agents push to it
              </Label>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bind-name">Name</Label>
              <Input
                id="bind-name"
                value={name}
                placeholder="deevy"
                onChange={(changed) => setName(changed.target.value)}
              />
            </div>

            {create.error ? (
              <p className="text-sm text-destructive">{create.error.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!socketId || !chosen || !name.trim() || create.isPending}
              onClick={() => {
                if (!socketId || !chosen) return;
                create.mutate({
                  slug: slugFor(chosen.scopeKey),
                  name: name.trim(),
                  tracker: { socketId, scope: chosen.scope },
                  // The container's own scope, which carries the branch the
                  // tool says it defaults to (forgeBindingOf).
                  ...(holdsCode && codeHereToo ? { forge: { socketId, scope: chosen.scope } } : {}),
                });
              }}
            >
              Bind it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

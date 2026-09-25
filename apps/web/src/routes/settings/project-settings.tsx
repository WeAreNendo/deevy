import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CheckpointPolicy } from "@/components/checkpoint-policy";
import { ProjectBinding } from "@/components/project-binding";
import { useAutosave } from "@/lib/autosave";
import { orpc } from "@/lib/orpc";

/**
 * What a Project is called, what it is for, and whose it is — `projects.update`
 * and `projects.archive` had no UI until here (docs/plans/ui-redesign.md
 * slice 8). The detail pane of Settings › Projects, which is where a Project is
 * configured; it was a tab on the Project itself until 2026-09-11. Every field saves itself (docs/plans/ui-redesign-2.md slice G):
 * text on blur or Enter, each sending only what changed; one status line says
 * Saving, Saved, or what went wrong. Beneath it are the two things a Project
 * now is: what it is bound to, and what it asks at a Checkpoint (ADR-0024).
 */
export function ProjectSettingsForm({ projectSlug }: { projectSlug: string }) {
  const queryClient = useQueryClient();
  const project = useQuery(orpc.projects.get.queryOptions({ input: { slug: projectSlug } }));
  const me = useQuery(orpc.me.get.queryOptions());
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
  // What the fields show: the server's values until a keystroke, then the draft.
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const update = useMutation(
    orpc.projects.update.mutationOptions({
      // A save landing resets the draft of the field it carried, and only that
      // one: a description change must not wipe a name still being typed.
      onSuccess: async (_saved, variables) => {
        if ("name" in variables) setName(null);
        if ("description" in variables) setDescription(null);
        await refresh();
      },
    }),
  );
  const archive = useMutation(orpc.projects.archive.mutationOptions({ onSuccess: refresh }));

  type Change = { name?: string; description?: string | null };
  const autosave = useAutosave<Change>((change) =>
    update.mutateAsync({ slug: projectSlug, ...change }),
  );

  if (project.isPending) return <Skeleton className="h-48 w-full" />;
  if (project.isError) return <p className="text-destructive">{project.error.message}</p>;

  const shownName = name ?? project.data.name;
  const shownDescription = description ?? project.data.description ?? "";
  const admin = me.data?.member?.role === "admin";

  const saveName = () => {
    const next = shownName.trim();
    if (!next) {
      setNameError("A Project needs a name");
      setName(null);
      return;
    }
    setNameError(null);
    if (next !== project.data.name) void autosave.saveNow({ name: next });
    else setName(null);
  };
  const saveDescription = () => {
    const next = shownDescription.trim() === "" ? null : shownDescription;
    if (next !== (project.data.description ?? null)) void autosave.saveNow({ description: next });
    else setDescription(null);
  };

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <form className="flex flex-col gap-4" onSubmit={(submitted) => submitted.preventDefault()}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={shownName}
            aria-invalid={nameError ? true : undefined}
            onChange={(changed) => {
              setNameError(null);
              setName(changed.target.value);
            }}
            onBlur={saveName}
            onKeyDown={(pressed) => {
              if (pressed.key === "Enter") {
                pressed.preventDefault();
                saveName();
              }
            }}
          />
          {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            rows={3}
            value={shownDescription}
            placeholder="What this Project is for."
            onChange={(changed) => setDescription(changed.target.value)}
            onBlur={saveDescription}
          />
        </div>
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
          {autosave.status === "idle" ? "Changes save as you make them." : null}
        </p>
      </form>

      <ProjectBinding projectSlug={projectSlug} />
      <CheckpointPolicy projectSlug={projectSlug} />

      {admin && !project.data.archivedAt ? (
        <section className="flex flex-col gap-2 rounded-md border border-destructive/30 p-4">
          <h2 className="text-sm font-medium">Archive this Project</h2>
          <p className="text-sm text-muted-foreground">
            The Project leaves your Projects list and the Work list, and deevy takes nothing more
            from where its records live, so nothing new reaches an Agent. Nothing is deleted — its
            records, Runs and history stay readable.
          </p>
          <div className="flex gap-2">
            {confirming ? (
              <>
                <Button
                  variant="destructive"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate({ slug: projectSlug })}
                >
                  Yes, archive {projectSlug}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                Archive Project
              </Button>
            )}
          </div>
          {archive.error ? (
            <p className="text-sm text-destructive">{archive.error.message}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

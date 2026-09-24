import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/settings-page";
import { orpc } from "@/lib/orpc";

interface Draft {
  uid: string;
  name: string;
  approvalsRequired: number;
  excludeRequester: boolean;
  approverMemberIds: string[];
}

/**
 * What a Project asks of a Run before it goes past a Checkpoint (ADR-0020).
 *
 * The list is the policy: a Checkpoint left out of it is one the Project no
 * longer has, so this saves whole and explicitly rather than field by field.
 * Everything else in Settings autosaves; a policy about who may approve what
 * is the one place where "I was still typing" must not become the rule.
 */
export function CheckpointPolicy({ projectSlug }: { projectSlug: string }) {
  const client = useQueryClient();
  const saved = useQuery(orpc.checkpoints.list.queryOptions({ input: { projectSlug } }));
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  const set = useMutation(
    orpc.checkpoints.set.mutationOptions({
      onSuccess: async () => {
        setDrafts(null);
        await client.invalidateQueries({ queryKey: orpc.checkpoints.key() });
      },
    }),
  );

  // The server's list until somebody edits, then the draft: a policy being
  // written is not a policy until it is saved.
  const stored: Draft[] = (saved.data?.checkpoints ?? []).map((one, index) => ({
    uid: one.id ?? `saved-${String(index)}`,
    name: one.name,
    approvalsRequired: one.approvalsRequired,
    excludeRequester: one.excludeRequester,
    approverMemberIds: one.approverMemberIds,
  }));
  const shown = drafts ?? stored;
  const dirty = drafts !== null;

  useEffect(() => {
    if (set.isSuccess) set.reset();
  }, [set]);

  const edit = (uid: string, change: Partial<Draft>) =>
    setDrafts(shown.map((one) => (one.uid === uid ? { ...one, ...change } : one)));

  const humans = (members.data?.members ?? []).filter((member) => member.kind === "human");

  return (
    <SettingsSection
      aria-label="Checkpoints"
      title="Checkpoints"
      description="What this Project asks before a Run goes past a point an Agent stops at."
    >
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is configured, so every Checkpoint an Agent asks about wants one approval, from
          anybody. Name one to ask for more.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {shown.map((checkpoint) => (
          <li key={checkpoint.uid} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`name-${checkpoint.uid}`}>Name</Label>
                <Input
                  id={`name-${checkpoint.uid}`}
                  className="w-44"
                  value={checkpoint.name}
                  placeholder="ship"
                  onChange={(changed) => edit(checkpoint.uid, { name: changed.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`approvals-${checkpoint.uid}`}>Approvals</Label>
                <Input
                  id={`approvals-${checkpoint.uid}`}
                  className="w-20"
                  type="number"
                  min={1}
                  value={String(checkpoint.approvalsRequired)}
                  onChange={(changed) =>
                    edit(checkpoint.uid, {
                      approvalsRequired: Math.max(1, Number(changed.target.value) || 1),
                    })
                  }
                />
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto"
                aria-label={`Remove ${checkpoint.name || "this Checkpoint"}`}
                onClick={() => setDrafts(shown.filter((one) => one.uid !== checkpoint.uid))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>

            <Label className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={checkpoint.excludeRequester}
                onCheckedChange={(checked) =>
                  edit(checkpoint.uid, { excludeRequester: checked === true })
                }
              />
              Not the Human the work is for
            </Label>

            {humans.length > 0 ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs text-muted-foreground">
                  Who may rule. None named means every active Human.
                </legend>
                <div className="flex flex-wrap gap-2">
                  {humans.map((human) => {
                    const named = checkpoint.approverMemberIds.includes(human.id);
                    return (
                      <Label
                        key={human.id}
                        className="flex items-center gap-2 rounded-md border px-2 py-1 font-normal"
                      >
                        <Checkbox
                          checked={named}
                          onCheckedChange={(checked) =>
                            edit(checkpoint.uid, {
                              approverMemberIds:
                                checked === true
                                  ? [...checkpoint.approverMemberIds, human.id]
                                  : checkpoint.approverMemberIds.filter((id) => id !== human.id),
                            })
                          }
                        />
                        {human.user.name}
                      </Label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </li>
        ))}
      </ul>

      {set.error ? <p className="text-sm text-destructive">{set.error.message}</p> : null}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setDrafts([
              ...shown,
              {
                uid: `new-${String(shown.length)}-${String(Date.now())}`,
                name: "",
                approvalsRequired: 1,
                excludeRequester: false,
                approverMemberIds: [],
              },
            ])
          }
        >
          <Plus aria-hidden />
          Add a Checkpoint
        </Button>
        <Button
          size="sm"
          disabled={set.isPending}
          onClick={() =>
            set.mutate({
              projectSlug,
              checkpoints: shown
                .filter((one) => one.name.trim().length > 0)
                .map((one) => ({
                  name: one.name.trim(),
                  approvalsRequired: one.approvalsRequired,
                  excludeRequester: one.excludeRequester,
                  approverMemberIds: one.approverMemberIds,
                })),
            })
          }
        >
          Save policy
        </Button>
        {dirty ? (
          <Button size="sm" variant="ghost" onClick={() => setDrafts(null)}>
            Reset
          </Button>
        ) : null}
      </div>
    </SettingsSection>
  );
}

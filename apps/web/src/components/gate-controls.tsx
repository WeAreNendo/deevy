import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Shortcut } from "@/components/kbd-hint";
import { orpc } from "@/lib/orpc";
import { useShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** A Gate as `gates.get` answers one; the screens pass it straight through. */
export interface GateView {
  id: string;
  checkpoint: string;
  visit: number;
  status: "open" | "approved" | "rejected" | "superseded";
  approvals: number;
  policy: { approvalsRequired: number; excludeRequester: boolean; approverMemberIds: string[] };
  you: { mayRule: boolean; hasRuled: boolean; why: string | null };
}

/**
 * Where a Gate is decided (ADR-0004, ADR-0020).
 *
 * One card, and the only place in deevy a ruling is made. It says the
 * arithmetic out loud — "1 of 2" — because four-eyes is a promise a Human has
 * to be able to check, and it says why it will not take a ruling from this
 * Human before they click rather than after: the reason is the server's own,
 * so the disabled button and the refusal behind it can never disagree.
 *
 * `⇧A` and `⇧R` choose a ruling and put the cursor in the Note; `⌘↵` commits
 * it. Nothing here commits on a keypress alone — a ruling is a decision, and
 * the last key is always deliberate.
 */
export function GateControls({
  gate,
  focused = false,
  shortcutScope,
  className,
}: {
  gate: GateView;
  /** The Human was sent here to rule: the card says so and takes the keys. */
  focused?: boolean;
  shortcutScope?: string;
  className?: string;
}) {
  const client = useQueryClient();
  const [note, setNote] = useState("");
  const [ruling, setRuling] = useState<"approved" | "rejected" | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const open = gate.status === "open";

  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: orpc.gates.key() });
    await client.invalidateQueries({ queryKey: orpc.runs.key() });
  };
  const approve = useMutation(orpc.gates.approve.mutationOptions({ onSuccess: invalidate }));
  const reject = useMutation(orpc.gates.reject.mutationOptions({ onSuccess: invalidate }));
  const pending = approve.isPending || reject.isPending;
  const error = approve.error ?? reject.error;

  const choose = (next: "approved" | "rejected") => {
    if (!open || !gate.you.mayRule) return;
    setRuling(next);
    noteRef.current?.focus();
  };
  const commit = (next: "approved" | "rejected" | null = ruling) => {
    if (!next || !open || !gate.you.mayRule || pending) return;
    const input = { requestId: gate.id, ...(note.trim() ? { note: note.trim() } : {}) };
    if (next === "approved") approve.mutate(input);
    else reject.mutate(input);
  };

  useShortcut("shift+a", () => choose("approved"), shortcutScope ? { scope: shortcutScope } : {});
  useShortcut("shift+r", () => choose("rejected"), shortcutScope ? { scope: shortcutScope } : {});

  // A Gate that has been ruled on is history: the card still says what was
  // decided, and the controls are gone rather than disabled, because there is
  // nothing left to do here.
  return (
    <section
      role="group"
      aria-label={`${gate.checkpoint} Gate`}
      data-slot="gate-controls"
      {...(focused ? { "data-focused": "true" } : {})}
      {...(ruling ? { "data-ruling": ruling } : {})}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        open ? "border-gate/40 bg-gate/5" : "bg-card",
        focused && "ring-2 ring-gate/40",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">
            {open ? "Waiting on a ruling" : `This Gate was ${gate.status}`}
          </span>
          <span className="text-xs text-muted-foreground">
            {gate.checkpoint}
            {gate.visit > 1 ? ` · visit ${String(gate.visit)}` : ""}
          </span>
        </div>
        {/* The arithmetic, in the two numbers that decide it. */}
        <span className="font-mono text-sm tabular-nums" data-slot="gate-standing">
          {gate.approvals} of {gate.policy.approvalsRequired}
        </span>
      </header>

      {focused && open ? (
        <p role="status" className="text-sm text-gate-foreground dark:text-gate">
          Waiting on your ruling.
        </p>
      ) : null}

      {open ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`gate-note-${gate.id}`}>Note</Label>
            <Textarea
              id={`gate-note-${gate.id}`}
              ref={noteRef}
              rows={2}
              value={note}
              placeholder="Why, in a sentence. Optional on an approval."
              disabled={!gate.you.mayRule || pending}
              onChange={(changed) => setNote(changed.target.value)}
              onKeyDown={(pressed) => {
                if (pressed.key === "Enter" && (pressed.metaKey || pressed.ctrlKey)) {
                  pressed.preventDefault();
                  commit();
                }
              }}
            />
          </div>

          {gate.you.why ? (
            <p className="text-sm text-muted-foreground">{gate.you.why}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              <Shortcut keys="shift+a" /> approve · <Shortcut keys="shift+r" /> reject ·{" "}
              <Shortcut keys="mod+enter" /> commit
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={ruling === "approved" ? "default" : "outline"}
              disabled={!gate.you.mayRule || pending}
              onClick={() => {
                setRuling("approved");
                commit("approved");
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant={ruling === "rejected" ? "default" : "outline"}
              disabled={!gate.you.mayRule || pending}
              onClick={() => {
                setRuling("rejected");
                commit("rejected");
              }}
            >
              Reject
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** Focuses the Note when a Gate screen is opened with a ruling in mind. */
export function useFocusNote(focused: boolean, id: string) {
  useEffect(() => {
    if (!focused) return;
    document.getElementById(`gate-note-${id}`)?.focus();
  }, [focused, id]);
}

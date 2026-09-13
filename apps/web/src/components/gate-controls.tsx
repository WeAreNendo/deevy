import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc";
import { PAGE_SCOPE, useShortcut } from "@/lib/shortcuts";
import { MemberChip } from "@/components/member-chip";
import { RailHeading } from "@/components/rail-heading";
import { ago } from "@/lib/time";

interface State {
  id: string;
  name: string;
  isGate: boolean;
}

/** What the Gate an Issue is in has got to (docs/plans/four-eyes-gates.md). */
export interface GateStanding {
  required: number;
  eligible: number;
  excludeRequester: boolean;
  approvals: Array<{ memberId: string; name: string | null; note: string | null }>;
  mayApprove: boolean;
  refusedBecause: "not_an_approver" | "requester" | "approved" | "too_few_humans" | null;
  /** Approvals this Gate had until the Document under them changed. */
  clearedByAnEdit: number;
}

/** What has been written since a ruling, as a sentence rather than a list. */
function sentence(since: Array<{ name: string; version: number }>): string {
  const named = since.map((one) => `${one.name} (now v${one.version})`);
  const all =
    named.length > 2 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named.join(" and ");
  return `Written since: ${all}. What was approved is under History.`;
}

/** Why the buttons are not yours to press, said where they would be. */
function whyNot(standing: GateStanding, issueKey: string, wanted: number): string | null {
  switch (standing.refusedBecause) {
    case "not_an_approver":
      return "This Gate names who may decide it, and you are not one of them.";
    case "requester":
      return `You brought ${issueKey} here, so this Gate asks somebody else to agree.`;
    case "approved":
      return `You have approved. It is waiting for ${String(wanted)} more ${
        wanted === 1 ? "Human" : "Humans"
      }.`;
    case "too_few_humans":
      return null; // The arithmetic below says it better than a reason would.
    default:
      return null;
  }
}

interface GateControlsProps {
  /** The shortcut scope the Issue is shown in, so `s`, `⇧A` and `⇧R` reach this card. */
  shortcutScope?: string;
  issueKey: string;
  projectKey: string;
  state: State;
  decisions: Array<{
    id: string;
    decision: string;
    note: string | null;
    createdAt: string | Date;
    /** Which Gate this was, and who ruled: what makes one ruling tell itself apart. */
    stateId: string;
    memberId: string | null;
    /** What each Document said when this was ruled on. */
    documents: Array<{ name: string; version: number }>;
  }>;
  /** How far along the Gate is; absent for a State that is not one. */
  standing?: GateStanding | null;
  /**
   * How many of this Issue's sub-issues are still open, and how many there are.
   * Said, not enforced: a Gate on a parent whose parts are unfinished is not
   * blocked, because nothing an Agent proposes ships without a Human deciding
   * it did and this informs that Human rather than overruling them
   * (docs/plans/sub-issue-delegation.md).
   */
  openChildren?: number;
  childCount?: number;
}

/**
 * How an Issue leaves the State it is in. A Gate needs a Human's approval
 * (CONTEXT.md), so it gets Approve and Reject; anything else gets a plain
 * State picker.
 */
export function GateControls({
  issueKey,
  projectKey,
  state,
  decisions,
  standing,
  openChildren = 0,
  childCount = 0,
  shortcutScope = PAGE_SCOPE,
}: GateControlsProps) {
  const queryClient = useQueryClient();
  const workflow = useQuery(orpc.workflow.get.queryOptions({ input: { projectKey } }));
  // Who ruled, for the history below: the page has this list already, so it is
  // a cache read rather than a request.
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  // Where the Documents have got to since, so a ruling can say when the text it
  // was made about has moved on. The Documents pane asks for this too.
  const documents = useQuery(orpc.documents.list.queryOptions({ input: { issueKey } }));
  // A ruling changes the Issue, what the inbox owes, and the Run that asked.
  const refresh = () =>
    Promise.all(
      [orpc.issues.key(), orpc.inbox.key(), orpc.runs.key()].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );

  const approve = useMutation(orpc.gates.approve.mutationOptions({ onSuccess: refresh }));
  const reject = useMutation(orpc.gates.reject.mutationOptions({ onSuccess: refresh }));
  const move = useMutation(orpc.issues.move.mutationOptions({ onSuccess: refresh }));
  const [note, setNote] = useState("");
  const busy = approve.isPending || reject.isPending || move.isPending;
  const given = standing?.approvals.length ?? 0;
  const wanted = Math.max((standing?.required ?? 1) - given, 0);
  const stuck = standing ? standing.eligible < standing.required : false;
  const refusal = standing ? whyNot(standing, issueKey, wanted) : null;
  const mayRule = standing ? standing.mayApprove : true;
  const failed = approve.error ?? reject.error ?? move.error;

  // The keyboard (docs/plans/ui-redesign.md): `s` opens the State picker, or on
  // a Gate puts the cursor in the Note; `⇧A` / `⇧R` do that with the ruling
  // chosen, so that `⌘↵` in the Note is the ruling. Nothing here commits
  // without that last key or a click.
  /** The pinned Documents this ruling covered that have been written since. */
  const movedOn = (pinned: Array<{ name: string; version: number }>) =>
    pinned.flatMap((one) => {
      const now = (documents.data?.documents ?? []).find((each) => each.name === one.name);
      return now && now.currentVersion > one.version
        ? [{ name: one.name, version: now.currentVersion }]
        : [];
    });

  const noteField = useRef<HTMLTextAreaElement>(null);
  const [stateOpen, setStateOpen] = useState(false);
  const [ruling, setRuling] = useState<"approve" | "reject">("approve");
  const rule = (which: "approve" | "reject") => {
    if (busy) return;
    const input = { key: issueKey, note: note.trim() || null };
    if (which === "approve") approve.mutate(input);
    else reject.mutate(input);
  };
  const aim = (which: "approve" | "reject") => {
    setRuling(which);
    noteField.current?.scrollIntoView({ block: "center" });
    noteField.current?.focus();
  };
  useShortcut("s", () => (state.isGate ? aim(ruling) : setStateOpen(true)), {
    scope: shortcutScope,
  });
  useShortcut("shift+a", () => aim("approve"), { scope: shortcutScope, enabled: state.isGate });
  useShortcut("shift+r", () => aim("reject"), { scope: shortcutScope, enabled: state.isGate });

  return (
    <section className="flex flex-col gap-3">
      <RailHeading>State</RailHeading>

      {state.isGate ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <p className="text-sm">
            <strong>{state.name}</strong> is a Gate:{" "}
            {standing && standing.required > 1
              ? `${issueKey} needs ${String(standing.required)} Humans to agree, and ${
                  given === 0 ? "none have" : `${String(given)} ${given === 1 ? "has" : "have"}`
                }.`
              : `${issueKey} cannot leave it without a Human's decision.`}
          </p>

          {openChildren > 0 ? (
            // Said rather than enforced. The Human rules or does not; this is
            // so they are not the last to know their Agent is still working.
            // Not a live region: it never changes while anybody is reading it,
            // and the Gate banner above is the one thing on this card that
            // announces itself (the deevy-ui skill).
            <p className="text-sm text-muted-foreground">
              {openChildren} of {childCount} {childCount === 1 ? "sub-issue" : "sub-issues"}{" "}
              {openChildren === 1 ? "is" : "are"} still open.
            </p>
          ) : null}

          {given > 0 ? (
            <ul aria-label="Approvals" className="flex flex-col gap-1 text-sm">
              {standing?.approvals.map((approval) => (
                <li key={approval.memberId} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{approval.name ?? "Somebody"}</span>
                  <span className="text-muted-foreground">approved</span>
                  {approval.note ? (
                    <span className="text-muted-foreground">{approval.note}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {stuck && standing ? (
            <p className="text-sm font-medium">
              This Gate wants {standing.required} approvals and only {standing.eligible}{" "}
              {standing.eligible === 1 ? "Human" : "Humans"} could give one
              {standing.excludeRequester ? ", once you are left out" : ""}. Ask an admin to lower
              it, or to reinstate whoever is suspended.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="gate-note">Note</Label>
            <Textarea
              id="gate-note"
              ref={noteField}
              rows={3}
              value={note}
              placeholder="Optional. Why you are approving or rejecting."
              onChange={(changed) => setNote(changed.target.value)}
              onKeyDown={(pressed) => {
                if (pressed.key === "Enter" && (pressed.metaKey || pressed.ctrlKey)) {
                  pressed.preventDefault();
                  rule(ruling);
                }
              }}
            />
          </div>
          {refusal ? <p className="text-sm text-muted-foreground">{refusal}</p> : null}

          <div className="flex gap-2" data-ruling={ruling}>
            <Button
              variant={ruling === "approve" ? "default" : "outline"}
              disabled={busy || !mayRule}
              onClick={() => rule("approve")}
            >
              Approve
            </Button>
            <Button
              variant={ruling === "reject" ? "default" : "outline"}
              disabled={busy}
              onClick={() => rule("reject")}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <Select
          value={state.id}
          disabled={busy}
          open={stateOpen}
          onOpenChange={setStateOpen}
          onValueChange={(next) => {
            if (next && next !== state.id) move.mutate({ key: issueKey, stateId: next });
          }}
        >
          <SelectTrigger aria-label="State" className="w-64">
            <SelectValue>
              {(selected: string) =>
                workflow.data?.states.find((s) => s.id === selected)?.name ?? state.name
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {workflow.data?.states.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                  {option.isGate ? " (Gate)" : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {standing && standing.clearedByAnEdit > 0 ? (
        // Somebody approved this an hour ago and their approval is gone. Saying
        // why, where the buttons are, is the difference between a rule and a
        // mystery (ADR-0021).
        <p className="text-xs text-muted-foreground">
          {standing.clearedByAnEdit === 1 ? "An approval was" : "Approvals were"} cleared: the
          Document changed after {standing.clearedByAnEdit === 1 ? "it was" : "they were"} given, so
          this Gate is asking again.
        </p>
      ) : null}

      {failed ? <p className="text-sm text-destructive">{failed.message}</p> : null}

      {decisions.length > 0 ? (
        /*
         * A ruling says which Gate it was at and who made it. Without those an
         * Issue that came through Intent, Spec and Plan showed three lines that
         * read the same — the word "approved" and a note — and nothing told you
         * they were three different decisions (2026-09-11).
         */
        <ul aria-label="Gate decisions" className="flex flex-col gap-2">
          {decisions.map((decision) => {
            const at = (workflow.data?.states ?? []).find((one) => one.id === decision.stateId);
            const by = (members.data?.members ?? []).find((one) => one.id === decision.memberId);
            return (
              <li key={decision.id} className="flex flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{at?.name ?? "A Gate"}</span>
                  <Badge variant={decision.decision === "approved" ? "default" : "destructive"}>
                    {decision.decision}
                  </Badge>
                  {by ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">by</span>
                      <MemberChip member={by} size="inline" />
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {ago(decision.createdAt, { short: true })}
                  </span>
                </span>
                {decision.documents.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    on {decision.documents.map((one) => `${one.name} v${one.version}`).join(" · ")}
                  </span>
                ) : null}
                {/*
                 * An approval is about words, and the words keep moving: an
                 * Agent may write the spec again the minute after a Human
                 * agreed to it. Say so where the approval is, rather than
                 * letting the page imply the current text was the approved one.
                 */}
                {decision.decision === "approved" && movedOn(decision.documents).length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {sentence(movedOn(decision.documents))}
                  </span>
                ) : null}
                {decision.note ? (
                  <span className="text-muted-foreground">“{decision.note}”</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

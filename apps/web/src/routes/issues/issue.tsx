import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { ActivityStream } from "@/components/activity-stream";
import { GateControls } from "@/components/gate-controls";
import { StateBadge } from "@/components/state-badge";
import { IssueDocuments } from "@/components/issue-documents";
import { IssueLinks } from "@/components/issue-links";
import { IssueRuns } from "@/components/run-card";
import { LabelPicker } from "@/components/label-picker";
import { ParentPicker } from "@/components/parent-picker";
import { Button } from "@/components/ui/button";
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
import { MarkdownEditor } from "@/components/markdown-editor";
import { InlineTitle } from "@/components/inline-title";
import { useAutosave } from "@/lib/autosave";
import { useMentionables } from "@/lib/mentions";
import { roomFor, useRoom } from "@/lib/rooms";
import { PAGE_SCOPE, useShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { client as orpcClient, orpc } from "@/lib/orpc.ts";
import { isNotFound, NotFoundPage } from "@/routes/not-found";
import { RailHeading } from "@/components/rail-heading";

const UNASSIGNED = "unassigned";

/** One Issue: its title and description, its State, its family, and its timeline. */
export function IssuePage({
  issueKey,
  focusGate = false,
  shortcutScope = PAGE_SCOPE,
}: {
  issueKey: string;
  /** Put the ruling in front of the reader, as `?gate=` does: the Inbox opens a Gate Notification this way. */
  focusGate?: boolean;
  /** Where the Issue is shown, so `a`/`s`/`l`/`p` reach this one: the page, or the peek's scope. */
  shortcutScope?: string;
}) {
  const queryClient = useQueryClient();
  const issue = useQuery(orpc.issues.get.queryOptions({ input: { key: issueKey } }));
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  // `a` opens the Assignee picker (docs/plans/ui-redesign.md, "Keyboard").
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  useShortcut("a", () => setAssigneeOpen(true), { scope: shortcutScope });

  // `?gate=<stateId>` is what an Agent's URL elicitation hands a Human
  // (docs/plans/m2.md): the Issue opens with the Gate it is waiting on in
  // front of them rather than somewhere down the page. A link to a Gate the
  // Issue has since left highlights nothing, which is the honest answer.
  const search = useRouterState({ select: (state) => state.location.search }) as Record<
    string,
    unknown
  >;
  const askedGate = typeof search.gate === "string" ? search.gate : null;
  const gateFocused =
    (askedGate !== null && askedGate === issue.data?.state.id) ||
    (focusGate && issue.data?.state.isGate === true);
  const gatePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gateFocused) gatePanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [gateFocused]);

  const refresh = () =>
    // The timeline and the Runs on this page read the edit too.
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.issues.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.events.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
    ]);

  const update = useMutation(orpc.issues.update.mutationOptions({ onSuccess: refresh }));

  /*
   * The title and the description are edited in place, so there is no Save
   * button to report what happened: one autosave serves both, and the line
   * beside the key says Saving…/Saved or offers Retry (`lib/autosave.ts`).
   */
  const edits = useAutosave<{ title?: string; description?: string | null }>(async (patch) => {
    await orpcClient.issues.update({ key: issueKey, ...patch });
    await refresh();
  });
  const [draftDescription, setDraftDescription] = useState<string | null>(null);
  const mentionables = useMentionables();
  const descriptionRoom = roomFor({ kind: "description", issueKey });
  const descriptionLive = Boolean(useRoom(descriptionRoom));

  if (issue.isPending) return <p className="text-muted-foreground">Loading {issueKey}…</p>;
  if (issue.isError) {
    if (isNotFound(issue.error)) {
      return <NotFoundPage what={`Issue ${issueKey}`} detail={issue.error.message} />;
    }
    return (
      <p className="text-destructive">
        Could not load {issueKey}: {issue.error.message}
      </p>
    );
  }

  const { id, key, title, description, state, assignee, parent, children, gateDecisions, labels } =
    issue.data;
  // How much of this Issue is still somebody's work, which is what its Gate
  // wants to say and what its sub-issue list is counted by.
  const open = children.filter((child) => child.state.category !== "done").length;
  const badgeState = {
    name: state.name,
    isGate: state.isGate,
    category: state.category as "backlog" | "active" | "done",
  };

  /**
   * Leaving the description, or ⌘Enter in it, is the save — where there is no
   * room. In one, the room saves it when the typing stops (ADR-0021).
   */
  const saveDescription = () => {
    if (descriptionLive) return;
    if (draftDescription === null || draftDescription === (description ?? "")) return;
    void edits
      .saveNow({ description: draftDescription.trim() === "" ? null : draftDescription })
      .then(() => setDraftDescription(null));
  };

  return (
    <article className="@container flex flex-col gap-6">
      {gateFocused ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-gate/50 bg-gate/10 px-4 py-2 text-sm"
        >
          <span>
            Waiting on your ruling at the <strong>{state.name}</strong> Gate.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              gatePanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              document.getElementById("gate-note")?.focus();
            }}
          >
            Rule now
          </Button>
        </div>
      ) : null}

      {/*
       * Provenance (docs/plans/issue-view.md, chosen from ten): the Documents
       * are the page and say who wrote them, and the rail is wide enough to
       * hold a ruling and the Run that asked for it — 300px was a gutter, and
       * a Run feed under the Documents pushed the conversation off the screen.
       */}
      <div className="grid grid-cols-1 gap-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono text-muted-foreground">{key}</span>
              <StateBadge state={badgeState} />
              <span className="flex-1" />
              <span role="status" className="text-xs text-muted-foreground">
                {edits.status === "saving"
                  ? "Saving…"
                  : edits.status === "saved"
                    ? "Saved"
                    : edits.status === "error"
                      ? (edits.error ?? "Not saved")
                      : null}
              </span>
              {edits.status === "error" ? (
                <Button size="xs" variant="outline" onClick={edits.retry}>
                  Retry
                </Button>
              ) : null}
            </div>

            <InlineTitle value={title} onSave={(next) => void edits.saveNow({ title: next })} />
          </header>

          {/*
           * The description is edited where it is read too, and by the same
           * rule as a Document: leaving it writes it. It wears no input chrome
           * for the same reason — it is the page's own words, not a field on a
           * form about them.
           */}
          <MarkdownEditor
            className="border-transparent bg-transparent shadow-none focus-within:border-transparent focus-within:ring-0 dark:bg-transparent"
            id={`description-${key}`}
            aria-label="Description"
            room={descriptionRoom}
            value={draftDescription ?? description ?? ""}
            onChange={setDraftDescription}
            onBlur={saveDescription}
            onSubmit={saveDescription}
            mentions={mentionables}
            rows={6}
            placeholder="What this Issue is, and why."
          />

          <IssueDocuments issueKey={key} shortcutScope={shortcutScope} />

          <ActivityStream issueId={id} issueKey={key} />
        </div>

        <aside className="flex flex-col gap-5 @3xl:order-none -order-1">
          <div
            ref={gatePanel}
            role="group"
            aria-label={state.isGate ? `${state.name} Gate` : `${state.name} State`}
            {...(gateFocused ? { "data-focused": "true" } : {})}
            className={cn(
              "rounded-lg",
              state.isGate && "border border-gate/40 bg-gate/5 p-3",
              gateFocused && "ring-2 ring-gate ring-offset-2 ring-offset-background",
            )}
          >
            <GateControls
              openChildren={open}
              childCount={children.length}
              issueKey={key}
              projectKey={issue.data.project.key}
              state={state}
              decisions={gateDecisions}
              standing={issue.data.gate}
              shortcutScope={shortcutScope}
            />
          </div>

          <IssueRuns issueKey={key} decisions={gateDecisions} />

          <section className="flex flex-col gap-2">
            <RailHeading>Assignee</RailHeading>
            <Select
              value={assignee?.id ?? UNASSIGNED}
              disabled={update.isPending}
              open={assigneeOpen}
              onOpenChange={setAssigneeOpen}
              onValueChange={(next) =>
                update.mutate({ key, assigneeMemberId: next === UNASSIGNED ? null : next })
              }
            >
              <SelectTrigger aria-label="Assignee" className="w-full">
                <SelectValue>
                  {(selected: string) => {
                    const member = members.data?.members.find((m) => m.id === selected);
                    return selected === UNASSIGNED || !member ? "Unassigned" : member.user.name;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                </SelectGroup>
                {/* Names as text, under the kind they are: the group says Human or Agent. */}
                {(["human", "agent"] as const).map((kind) => {
                  const ofKind = (members.data?.members ?? []).filter((m) => m.kind === kind);
                  if (ofKind.length === 0) return null;
                  return (
                    <Fragment key={kind}>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>{kind === "human" ? "Humans" : "Agents"}</SelectLabel>
                        {ofKind.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.user.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </Fragment>
                  );
                })}
              </SelectContent>
            </Select>
          </section>

          <LabelPicker issueKey={key} labels={labels} shortcutScope={shortcutScope} />

          <ParentPicker
            issueKey={key}
            projectKey={issue.data.project.key}
            parent={parent}
            shortcutScope={shortcutScope}
          />

          {children.length > 0 ? (
            <section className="flex flex-col gap-2">
              <RailHeading>
                Sub-issues
                {open > 0 ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {open} of {children.length} open
                  </span>
                ) : null}
              </RailHeading>
              <ul className="flex flex-col gap-1">
                {children.map((child) => (
                  // One line each: a rail is narrow, and three Issues wrapping
                  // to two lines apiece reads as six things rather than three.
                  <li key={child.id} className="flex min-w-0 items-baseline text-sm">
                    <Link
                      to="/issues/$issueKey"
                      params={{ issueKey: child.key }}
                      title={`${child.key} ${child.title}`}
                      className="flex min-w-0 items-baseline gap-1.5 hover:underline"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {child.key}
                      </span>
                      <span className="truncate">{child.title}</span>
                    </Link>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
                      {/* An Agent is on it right now, which is the one thing a
                          reader of this list wants and cannot get from the
                          State (docs/plans/sub-issue-delegation.md). */}
                      {child.hasOpenRun ? (
                        // `img` rather than a bare span: a generic role carries
                        // no accessible name, so the label would be there in
                        // the DOM and absent from a screen reader.
                        <span
                          role="img"
                          aria-label="An Agent is working this"
                          title="An Agent is working this"
                          className="size-1.5 rounded-full bg-agent"
                        />
                      ) : null}
                      {/* A State's name is whatever the Workflow editor called
                          it, and the rail is narrow. */}
                      <span className="max-w-24 truncate text-xs text-muted-foreground">
                        {child.state.name}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <IssueLinks issueKey={key} />

          <p className="font-mono text-xs text-muted-foreground">
            updated {new Date(issue.data.updatedAt).toLocaleString()}
          </p>
        </aside>
      </div>
    </article>
  );
}

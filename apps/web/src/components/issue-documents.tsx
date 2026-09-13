import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useMentionables } from "@/lib/mentions";
import { MemberChip } from "@/components/member-chip";
import { Present } from "@/components/present";
import { roomFor, useRoom } from "@/lib/rooms";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";
import { PAGE_SCOPE, useShortcut } from "@/lib/shortcuts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoreHorizontal } from "lucide-react";
import { useAutosave } from "@/lib/autosave";
import { client as orpcClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

/**
 * The Documents on an Issue: intent, spec, plan, whichever the Workflow asked
 * for. Writes are versions, so an older one stays readable (CONTEXT.md).
 */
export function IssueDocuments({
  issueKey,
  shortcutScope = PAGE_SCOPE,
}: {
  issueKey: string;
  /** The shortcut scope the Issue is shown in, so `[` and `]` turn these tabs. */
  shortcutScope?: string;
}) {
  const documents = useQuery(orpc.documents.list.queryOptions({ input: { issueKey } }));
  const [active, setActive] = useState<string | null>(null);
  const names = (documents.data?.documents ?? []).map((doc) => doc.name);
  const current = active && names.includes(active) ? active : names[0];
  const turn = (by: -1 | 1) => {
    if (!current || names.length < 2) return;
    const at = names.indexOf(current);
    setActive(names[(at + by + names.length) % names.length] ?? null);
  };
  useShortcut("[", () => turn(-1), { scope: shortcutScope });
  useShortcut("]", () => turn(1), { scope: shortcutScope });

  if (documents.isPending) return <Skeleton className="h-40 w-full" />;
  if (documents.isError) {
    return <p className="text-destructive">Could not load Documents: {documents.error.message}</p>;
  }
  if (documents.data.documents.length === 0) return null;

  const document = documents.data.documents.find((doc) => doc.name === current);
  if (!current || !document) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Documents</h2>
      <Tabs value={current} onValueChange={(next) => setActive(next)}>
        <TabsList aria-label="Documents">
          {names.map((name) => (
            <TabsTrigger key={name} value={name}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DocumentPane issueKey={issueKey} name={current} currentVersion={document.currentVersion} />
    </section>
  );
}

interface PaneProps {
  issueKey: string;
  name: string;
  currentVersion: number;
}

/**
 * A Document, open. There is no read mode: an intent, a spec or a plan is a
 * thing people write, so the editor is the view and the page saves it when you
 * leave the field — a version per sitting rather than one per keystroke, which
 * is what a version history has to mean to stay readable.
 *
 * Everything else about the Document is behind one `⋯`: its history, and what
 * you can do from there. A Select of version numbers in the header made a
 * reader choose a number before they could read anything.
 */
function DocumentPane({ issueKey, name, currentVersion }: PaneProps) {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState(false);
  const document = useQuery(
    orpc.documents.get.queryOptions({ input: { issueKey, name, version: currentVersion } }),
  );
  const versions = useQuery(orpc.documents.versions.queryOptions({ input: { issueKey, name } }));
  const mentionables = useMentionables();

  // The text on screen: the server's until somebody types, then theirs.
  const roomName = roomFor({ kind: "document", issueKey, document: name });
  const live = Boolean(useRoom(roomName));
  const [draft, setDraft] = useState<string | null>(null);
  const [basedOn, setBasedOn] = useState<number | null>(null);
  const body = draft ?? document.data?.body ?? "";

  const autosave = useAutosave<string>(async (next) => {
    await orpcClient.documents.write({
      issueKey,
      name,
      body: next,
      // What this edit started from, so a save that would land on top of
      // somebody else's is refused rather than quietly winning.
      baseVersion: basedOn ?? currentVersion,
    });
    setDraft(null);
    setBasedOn(null);
    await queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
  });

  if (document.isPending) return <Skeleton className="h-40 w-full" />;
  if (document.isError) {
    return (
      <p className="text-destructive">
        Could not load {name}: {document.error.message}
      </p>
    );
  }

  const contributors = versions.data?.versions ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Contributors versions={contributors} fallback={document.data.authorMemberId} />
        <Present room={roomName} />
        <span className="flex-1" />
        {/*
         * A live Document saves itself when the room goes quiet, so there is
         * nothing here to report: the status line belongs to the editor that
         * still writes through `documents.write` on blur.
         */}
        {live ? null : (
          <span role="status" className="text-xs text-muted-foreground">
            {autosave.status === "saving"
              ? "Saving…"
              : autosave.status === "saved"
                ? "Saved"
                : autosave.status === "error"
                  ? (autosave.error ?? "Not saved")
                  : null}
          </span>
        )}
        {!live && autosave.status === "error" ? (
          <Button size="xs" variant="outline" onClick={autosave.retry}>
            Retry
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setHistory(true)}>
                History<DropdownMenuShortcut>{contributors.length}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void navigator.clipboard?.writeText(document.data.body)}
              >
                Copy as Markdown
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The view is the editor. In a room the room writes the versions; where
          there is no room, leaving the text writes one. It wears no input
          chrome either way: a Document is the page, not a field on it. */}
      <MarkdownEditor
        className="border-transparent bg-transparent shadow-none focus-within:border-transparent focus-within:ring-0 dark:bg-transparent"
        id={`body-${name}`}
        room={roomName}
        value={body}
        onChange={(next) => {
          setDraft(next);
          if (basedOn === null) setBasedOn(currentVersion);
        }}
        onBlur={() => {
          if (!live && draft !== null && draft !== document.data.body) void autosave.saveNow(draft);
        }}
        mentions={mentionables}
        rows={16}
        placeholder={`Write the ${name}…`}
        onSubmit={() => {
          if (!live && draft !== null && draft !== document.data.body) void autosave.saveNow(draft);
        }}
      />

      <DocumentHistory
        issueKey={issueKey}
        name={name}
        currentVersion={currentVersion}
        versions={contributors}
        open={history}
        onOpenChange={setHistory}
      />
    </div>
  );
}

/**
 * Who has had a hand in this Document — everybody who wrote a version of it,
 * not only whoever wrote the one on screen. A Document an Agent drafted and two
 * Humans edited says all three, in the order they first touched it.
 */
function Contributors({
  versions,
  fallback,
}: {
  versions: Array<{
    authorMemberId: string | null;
    authorMemberIds: string[];
    writtenAt: Date | string;
  }>;
  fallback: string | null;
}) {
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const all = members.data?.members ?? [];
  // Every hand in every version, oldest first. A version written in a room has
  // more than one author (ADR-0021), so the byline unions them rather than
  // naming whoever happened to cut each one.
  const ids = versions.length
    ? [
        ...new Set(
          [...versions]
            .reverse()
            .flatMap((one) =>
              one.authorMemberIds.length > 0 ? one.authorMemberIds : [one.authorMemberId],
            ),
        ),
      ]
    : [fallback];
  const who = ids.map((id) => all.find((one) => one.id === id)).filter(Boolean);
  const last = versions[0]?.writtenAt;

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      <span>written by</span>
      {who.length === 0 ? <span className="text-foreground">deevy</span> : null}
      {who.map((member, index) => (
        <span key={member!.id} className="flex items-center gap-1.5">
          {index > 0 ? <span>{index === who.length - 1 ? "and" : ","}</span> : null}
          <MemberChip member={member!} size="inline" />
        </span>
      ))}
      {last ? <span>· last edit {ago(last, { short: true })}</span> : null}
    </p>
  );
}

/**
 * Every version of a Document, and a way back to one. Reading an older version
 * is its own screen rather than a mode the editor drops into: a Document you
 * are looking at is one you can type in, and an old version is not.
 */
function DocumentHistory({
  issueKey,
  name,
  currentVersion,
  versions,
  open,
  onOpenChange,
}: {
  issueKey: string;
  name: string;
  currentVersion: number;
  versions: Array<{
    version: number;
    authorMemberId: string | null;
    writtenAt: Date | string;
    rulings: Array<{ decision: "approved" | "rejected"; stateId: string }>;
  }>;
  open: boolean;
  onOpenChange: (to: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<number | null>(null);
  const at = reading ?? currentVersion;
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const body = useQuery(
    orpc.documents.get.queryOptions({ input: { issueKey, name, version: at }, enabled: open }),
  );
  const restore = useMutation(
    orpc.documents.write.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{name} · history</DialogTitle>
          <DialogDescription>
            Every version, newest first. Reading one does not change it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] gap-4 @2xl:grid-cols-[14rem_minmax(0,1fr)]">
          <ul
            aria-label={`Versions of ${name}`}
            className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto"
          >
            {versions.map((one) => {
              const member = (members.data?.members ?? []).find(
                (candidate) => candidate.id === one.authorMemberId,
              );
              return (
                <li key={one.version}>
                  <button
                    type="button"
                    aria-current={one.version === at ? "true" : undefined}
                    onClick={() => setReading(one.version)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
                      one.version === at && "bg-accent",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs">v{one.version}</span>
                      {one.version === currentVersion ? (
                        <span className="text-xs text-muted-foreground">current</span>
                      ) : null}
                      {/* The version a Gate ruled on is the one somebody agreed
                          to, which is worth finding again however far the
                          Document has moved on since. */}
                      {one.rulings.map((ruling, index) => (
                        <Badge
                          key={`${ruling.stateId}-${index}`}
                          variant={ruling.decision === "approved" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {ruling.decision}
                        </Badge>
                      ))}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {member ? <MemberChip member={member} size="inline" /> : <span>deevy</span>}
                      <span>{ago(one.writtenAt, { short: true })}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
            {body.isPending ? <Skeleton className="h-64 w-full" /> : null}
            {body.data ? <Markdown>{body.data.body}</Markdown> : null}
          </div>
        </div>

        <DialogFooter>
          {at !== currentVersion && body.data ? (
            <Button
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate({
                  issueKey,
                  name,
                  body: body.data.body,
                  baseVersion: currentVersion,
                })
              }
            >
              Restore v{at}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
        {restore.error ? <p className="text-sm text-destructive">{restore.error.message}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

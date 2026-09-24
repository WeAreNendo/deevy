import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Bot,
  CircleCheck,
  CircleX,
  Diamond,
  Inbox,
  MailOpen,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMaxWidth } from "@/hooks/use-max-width";
import { Shortcut } from "@/components/kbd-hint";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toneClass } from "@/lib/event-text";
import { describeNotification, type NotificationTone } from "@/lib/notification-text";
import { GatePage } from "@/routes/gates/gate";
import { WorkItemPage } from "@/routes/work/item";
import { orpc } from "@/lib/orpc";
import { useShortcut } from "@/lib/shortcuts";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

/** How the Inbox reads its URL: the selected Notification, and whether only unread are shown. */
export interface InboxSearch {
  n?: string;
  unread?: "1";
}

export function parseInboxSearch(search: Record<string, unknown>): InboxSearch {
  // A raw URL's `unread=1` parses as the number 1; navigate() hands over "1".
  const raw = search.unread;
  const unread = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  return {
    ...(typeof search.n === "string" && search.n ? { n: search.n } : {}),
    ...(unread === "1" || unread === "true" ? { unread: "1" as const } : {}),
  };
}

/** One glyph per row, in the hue of what is owed: a Gate, an Agent, a Human. */
function glyphFor(kind: string, tone: NotificationTone): LucideIcon {
  if (tone === "destructive") return CircleX;
  if (tone === "gate") return Diamond;
  if (kind === "mention") return AtSign;
  if (kind === "assignment") return UserPlus;
  if (kind === "run_awaiting_input") return Bot;
  return CircleCheck;
}

/**
 * What needs you, and the Issue it is about, side by side (docs/plans/
 * ui-redesign.md slice 6). Selecting a Notification opens its Issue in the
 * right pane — with the ruling card in front when a Gate is waiting, the
 * waiting Run first when an Agent asked — and marks it read, because reading
 * is what was owed. One flat list, newest first, each row a sentence: who did
 * what on which Issue, and what they wrote (lib/notification-text.ts). A
 * checkbox per row selects several to mark read at once.
 */
export function InboxPage({
  search,
  onSearch,
}: {
  search: InboxSearch;
  onSearch: (patch: Partial<InboxSearch>) => void;
}) {
  const queryClient = useQueryClient();
  // Too narrow for two panes below 1024px; the preview is a peek then.
  const narrow = useMaxWidth(1024);
  const inbox = useQuery(orpc.inbox.list.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.inbox.key() });
  const markRead = useMutation(orpc.inbox.markRead.mutationOptions({ onSuccess: refresh }));
  const markAllRead = useMutation(orpc.inbox.markAllRead.mutationOptions({ onSuccess: refresh }));

  const all = inbox.data?.notifications ?? [];
  const flat = useMemo(
    () => (search.unread === "1" ? all.filter((row) => !row.readAt) : all),
    [all, search.unread],
  );
  const selected =
    flat.find((row) => row.id === search.n) ?? all.find((row) => row.id === search.n);

  // Several rows at once: the checkboxes, `x` on the focused row, then one Mark read.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const markPickedRead = () =>
    markRead.mutate({ ids: [...picked] }, { onSuccess: () => setPicked(new Set()) });

  const open = (id: string) => {
    onSearch({ n: id });
    const row = all.find((candidate) => candidate.id === id);
    if (row && !row.readAt) markRead.mutate({ ids: [id] });
  };
  const move = (delta: number) => {
    if (flat.length === 0) return;
    const index = selected ? flat.findIndex((row) => row.id === selected.id) : -1;
    if (index === -1 && selected) {
      // Under the Unread filter the row just opened has left the list (opening
      // marks it read), so it is placed by where it sits among all of them:
      // `j` goes to the next unread after it, `k` to the last one before it.
      const anchor = all.findIndex((row) => row.id === selected.id);
      if (anchor !== -1) {
        const position = new Map(all.map((row, at) => [row.id, at]));
        const candidates = flat.filter((row) => {
          const at = position.get(row.id) ?? -1;
          return delta > 0 ? at > anchor : at < anchor;
        });
        const next = delta > 0 ? candidates[0] : candidates[candidates.length - 1];
        if (next) open(next.id);
        return;
      }
    }
    const next = flat[Math.min(flat.length - 1, Math.max(0, index + delta))];
    if (next) open(next.id);
  };
  useShortcut("j", () => move(1));
  useShortcut("k", () => move(-1));
  useShortcut("arrowdown", () => move(1));
  useShortcut("arrowup", () => move(-1));
  useShortcut("e", () => selected && !selected.readAt && markRead.mutate({ ids: [selected.id] }));
  useShortcut("x", () => selected && togglePicked(selected.id));
  useShortcut("shift+e", () => markAllRead.mutate({}));
  useShortcut("o", () => selected?.issue && window.open(selected.issue.url, "_blank", "noopener"));

  if (inbox.isError) {
    return <p className="text-destructive">Could not load your inbox: {inbox.error.message}</p>;
  }

  const list = (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby="inbox-heading">
      <PageHeader
        className="px-4 pt-4"
        title={<span id="inbox-heading">Inbox</span>}
        actions={
          picked.size > 0 ? (
            <div role="toolbar" aria-label="Selection" className="flex items-center gap-2">
              <span className="text-sm font-medium">{picked.size} selected</span>
              <Button size="sm" disabled={markRead.isPending} onClick={markPickedRead}>
                Mark read
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={markAllRead.isPending || all.every((row) => row.readAt)}
              onClick={() => markAllRead.mutate({})}
            >
              Mark all read
              <Shortcut keys="shift+e" />
            </Button>
          )
        }
      >
        <ToggleGroup
          value={[search.unread === "1" ? "unread" : "all"]}
          onValueChange={(next: string[]) =>
            onSearch({ unread: next[0] === "unread" ? "1" : undefined })
          }
          aria-label="Show"
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="unread">Unread</ToggleGroupItem>
        </ToggleGroup>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {inbox.isPending ? <Skeleton className="m-4 h-64" /> : null}
        {inbox.data && flat.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox aria-hidden />
              </EmptyMedia>
              {/* Under the Unread filter the list may be empty while All is not: say which. */}
              <EmptyTitle>
                {search.unread === "1" ? "Nothing unread" : "Nothing waiting"}
              </EmptyTitle>
              <EmptyDescription>
                {search.unread === "1"
                  ? "You're all caught up. Switch to All to see what you've already read."
                  : "Mentions, assignments and Gates will show up here as they happen."}
              </EmptyDescription>
            </EmptyHeader>
            {search.unread === "1" ? (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => onSearch({ unread: undefined })}>
                  Show All
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : null}
        <ul aria-label="Notifications" className="flex flex-col divide-y">
          {flat.map((notification) => {
            const said = describeNotification(notification);
            const Icon = glyphFor(notification.kind, said.tone);
            const isSelected = notification.id === search.n;
            const isPicked = picked.has(notification.id);
            return (
              <li
                key={notification.id}
                data-selected={isSelected ? "true" : undefined}
                className={cn(
                  "flex items-start gap-2 py-2 pr-2 pl-4 text-sm hover:bg-accent/60",
                  isSelected && "bg-accent",
                  isPicked && "bg-accent/40",
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  aria-label={`Select ${said.verb}`}
                  checked={isPicked}
                  onCheckedChange={() => togglePicked(notification.id)}
                />
                {/* The row opens the Notification; the checkbox and Mark read sit beside it. */}
                <button
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left outline-none focus-visible:underline"
                  onClick={() => open(notification.id)}
                >
                  <Icon
                    className={cn("mt-0.5 size-4 shrink-0", toneClass[said.tone])}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-x-3">
                      {/* A sentence with its own spaces, not flex items: the words sit as words do. */}
                      <span className="min-w-0 flex-1">
                        {/* The name alone: the glyph on the left already says what happened. */}
                        {notification.actor ? (
                          <span className="font-medium">{notification.actor.user.name}</span>
                        ) : (
                          <span className="text-muted-foreground">deevy</span>
                        )}{" "}
                        <span className={cn(!notification.readAt && "font-medium")}>
                          {said.verb}
                        </span>
                        {notification.issue ? (
                          <>
                            {" "}
                            <span className="text-muted-foreground">on</span>{" "}
                            <span className="font-mono text-xs whitespace-nowrap">
                              {notification.issue.externalKey}
                            </span>
                          </>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {ago(notification.createdAt)}
                      </span>
                    </span>
                    {notification.issue ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {notification.issue.title}
                      </span>
                    ) : null}
                    {said.excerpt ? (
                      <span className="line-clamp-2 text-muted-foreground">“{said.excerpt}”</span>
                    ) : null}
                  </span>
                </button>
                {notification.readAt ? null : (
                  <span className="flex items-center gap-1">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-gate" />
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate({ ids: [notification.id] })}
                    >
                      Mark read
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );

  // What the row is about, opened in front: a Gate is the ruling itself,
  // because ruling is what was owed; anything else is the record as deevy
  // knows it (docs/plans/sockets.md, slice 3).
  const gateRequestId =
    selected?.kind === "gate_awaiting"
      ? ((selected.event.payload as { gateRequestId?: unknown } | null)?.gateRequestId ?? null)
      : null;
  const preview = (
    <div className="h-full overflow-y-auto p-6">
      {typeof gateRequestId === "string" ? (
        <GatePage requestId={gateRequestId} />
      ) : selected?.issue ? (
        <WorkItemPage issueId={selected.issue.id} />
      ) : (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MailOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Pick a Notification</EmptyTitle>
            <EmptyDescription>
              Choose one from the list, and open the record where it lives.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );

  if (narrow) return list;

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize={34} minSize={24} className="min-w-0">
        {list}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={66} minSize={40} className="min-w-0">
        {preview}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SettingsSection } from "@/components/settings-page";
import { Button } from "@/components/ui/button";
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

/** Base UI wants real values for "nowhere" and "a channel I'll type", so the sentinels are constants. */
const NOWHERE = "__nowhere";
const TYPED = "__typed";

/**
 * The chat channel a Project's Gates are posted in (docs/plans/simplify.md,
 * slice 8): one message per Gate, with Approve and Reject on it, updated in
 * place when somebody rules. Whoever may rule sees it there without opening
 * deevy; Needs me is the same list, kept by deevy.
 *
 * Saving posts a hello in the channel before anything is stored, so a channel
 * the app was never added to is refused here, in the tool's own words, rather
 * than found out on the first Gate nobody sees. That is why this section saves
 * on a button and not as it changes: every save says something in the channel.
 */
export function ProjectChat({ projectSlug }: { projectSlug: string }) {
  const client = useQueryClient();
  const project = useQuery(orpc.projects.get.queryOptions({ input: { slug: projectSlug } }));
  const sockets = useQuery(orpc.sockets.list.queryOptions({ input: {} }));

  const savedSocket = project.data?.chatSocketId ?? null;
  const savedChannel = project.data?.chatChannel ?? null;
  // The draft, taken afresh whenever the Project read back names another
  // binding, so a save elsewhere is never put back by a stale screen.
  const [socketId, setSocketId] = useState<string | null>(savedSocket);
  const [channel, setChannel] = useState<string | null>(savedChannel);
  const [typing, setTyping] = useState(false);
  const [seen, setSeen] = useState(`${savedSocket}|${savedChannel}`);
  if (`${savedSocket}|${savedChannel}` !== seen) {
    setSeen(`${savedSocket}|${savedChannel}`);
    setSocketId(savedSocket);
    setChannel(savedChannel);
    setTyping(false);
  }

  const listing = useQuery({
    ...orpc.sockets.channels.queryOptions({ input: { socketId: socketId ?? "" } }),
    enabled: socketId !== null,
  });

  const update = useMutation(
    orpc.projects.update.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.projects.key() });
      },
    }),
  );

  if (project.isPending || sockets.isPending) return null;
  if (project.isError) return null;

  const boundTo = (sockets.data?.sockets ?? []).find((socket) => socket.id === savedSocket);
  // A paused tool keeps its binding, so the one this Project names stays on
  // offer; no other paused tool is worth binding to.
  const chats = (sockets.data?.sockets ?? []).filter(
    (socket) =>
      socket.capabilities.includes("chat") &&
      (socket.status === "active" || socket.id === savedSocket),
  );
  const chosen = chats.find((socket) => socket.id === socketId);
  const paused = boundTo !== undefined && boundTo.status !== "active";
  const toolName = (socket: (typeof chats)[number]) =>
    `${socket.name} (${providerLabel(socket.provider)})${socket.status === "active" ? "" : ", paused"}`;
  // Undefined while the tool is being asked, null when it lists none.
  const offered = listing.data?.channels;
  const typed = typing || offered === null;
  const nameOf = (id: string | null) =>
    id ? (offered ?? []).find((one) => one.id === id)?.name : undefined;
  const savedName = nameOf(savedChannel);

  const wanted = socketId ? (channel?.trim() ?? "") : "";
  const unchanged = socketId === savedSocket && (socketId === null || wanted === savedChannel);
  const ready = socketId === null || wanted !== "";

  const save = () =>
    update.mutate({
      slug: projectSlug,
      chat: socketId ? { socketId, channel: wanted } : null,
    });

  return (
    <SettingsSection
      aria-label="Chat"
      title="Chat"
      description="Where this Project's Gates are posted, with Approve and Reject on each, so whoever may rule sees them without opening deevy."
    >
      <p className="text-sm">
        {savedSocket && savedChannel ? (
          <>
            Gates are posted in{" "}
            <span className="font-mono text-xs">{savedName ? `#${savedName}` : savedChannel}</span>{" "}
            on {boundTo?.name ?? providerLabel(boundTo?.provider)}
            {paused ? (
              <>
                , which is paused: a Gate asked while it is paused is not posted there.{" "}
                <Link
                  to="/settings/sockets/$socketId"
                  params={{ socketId: boundTo.id }}
                  className="text-link underline-offset-4 hover:underline"
                >
                  Resume it
                </Link>
              </>
            ) : (
              "."
            )}
          </>
        ) : (
          "Gates are posted nowhere: they wait on Needs me, and in the tracker."
        )}
      </p>

      {chats.length === 0 && !savedSocket ? (
        <p className="text-xs text-muted-foreground">
          Connect Slack under{" "}
          <Link to="/settings/sockets" className="text-link underline-offset-4 hover:underline">
            Sockets
          </Link>{" "}
          to post this Project&apos;s Gates in a channel.
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            if (ready && !unchanged) save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-chat-socket">Post Gates in</Label>
            <Select
              value={socketId ?? NOWHERE}
              onValueChange={(next) => {
                setSocketId(next === NOWHERE ? null : (next as string));
                setChannel(null);
                setTyping(false);
                update.reset();
              }}
            >
              <SelectTrigger id="project-chat-socket" aria-label="Chat tool" className="w-56">
                <SelectValue>
                  {(selected: string) => {
                    const socket = chats.find((one) => one.id === selected);
                    return socket ? toolName(socket) : "Nowhere";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NOWHERE}>Nowhere</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Chat tools</SelectLabel>
                  {chats.map((socket) => (
                    <SelectItem key={socket.id} value={socket.id}>
                      {toolName(socket)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {socketId ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-chat-channel">Channel</Label>
              {typed ? (
                <Input
                  id="project-chat-channel"
                  className="w-56 font-mono"
                  value={channel ?? ""}
                  placeholder="C0123ABCD"
                  onChange={(changed) => {
                    setChannel(changed.target.value);
                    update.reset();
                  }}
                />
              ) : (
                <Select
                  value={channel ?? ""}
                  onValueChange={(next) => {
                    if (next === TYPED) {
                      setTyping(true);
                      setChannel("");
                    } else setChannel(next as string);
                    update.reset();
                  }}
                >
                  <SelectTrigger id="project-chat-channel" aria-label="Channel" className="w-56">
                    <SelectValue
                      placeholder={listing.isPending ? "Asking the tool…" : "Which channel"}
                    >
                      {(selected: string) => {
                        const name = nameOf(selected);
                        return name ? `#${name}` : selected;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(offered ?? []).map((one) => (
                        <SelectItem key={one.id} value={one.id}>
                          #{one.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectItem value={TYPED}>Type its id…</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}

          <Button type="submit" disabled={!ready || unchanged || update.isPending}>
            {update.isPending ? "Saying hello…" : socketId ? "Save and say hello" : "Save"}
          </Button>

          <div className="basis-full text-xs text-muted-foreground">
            {listing.data?.problem ? (
              <p>
                {chosen?.name ?? "The tool"} would not list its channels ({listing.data.problem}),
                so type the channel&apos;s id. Reinstall the app to pick from a list.
              </p>
            ) : socketId && typed ? (
              <p>
                The channel&apos;s id, from its details in the tool. Add the app to a private
                channel first.
              </p>
            ) : socketId ? (
              <p>Saving posts one line in the channel, to prove deevy can.</p>
            ) : null}
          </div>
        </form>
      )}

      {update.error ? (
        <p role="alert" className="text-sm text-destructive">
          {update.error.message}
        </p>
      ) : update.isSuccess && savedSocket ? (
        <p role="status" className="text-sm text-muted-foreground">
          Said hello in the channel. This Project&apos;s next Gate is posted there.
        </p>
      ) : null}
    </SettingsSection>
  );
}

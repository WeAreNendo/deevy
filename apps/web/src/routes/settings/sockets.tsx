import { Link } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Cable, ChevronRight } from "lucide-react";
import { ConnectGeneric } from "@/components/connect-generic";
import { ConnectGithub } from "@/components/connect-github";
import { ConnectGitlab } from "@/components/connect-gitlab";
import { ConnectLinear } from "@/components/connect-linear";
import { ConnectNotion } from "@/components/connect-notion";
import { ConnectSlack } from "@/components/connect-slack";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";
import { providerLabel } from "@/lib/providers";

/** What a Socket's status says about it, in the fewest words that are true. */
export function socketStanding(socket: {
  status: string;
  hasCredentials: boolean;
  lastInboundAt: Date | null;
}): { text: string; tone: "ok" | "waiting" | "quiet" } {
  if (socket.status === "pending") return { text: "Not connected yet", tone: "waiting" };
  if (socket.status === "paused") return { text: "Resting", tone: "waiting" };
  if (!socket.lastInboundAt) return { text: "Has not spoken yet", tone: "quiet" };
  const quiet = Date.now() - socket.lastInboundAt.getTime() > 24 * 60 * 60_000;
  return quiet
    ? { text: `Last spoke ${ago(socket.lastInboundAt)}`, tone: "quiet" }
    : { text: `Spoke ${ago(socket.lastInboundAt)}`, tone: "ok" };
}

/**
 * The tools this Workspace is connected to (ADR-0024).
 *
 * Connecting one is the most administering thing in deevy, because it is where
 * a credential enters — so this page offers exactly the providers the build
 * can speak, and nothing else.
 */
export function SocketsPage() {
  const client = useQueryClient();
  const sockets = useQuery(orpc.sockets.list.queryOptions({ input: {} }));
  const providers = useQuery(orpc.sockets.providers.queryOptions({ input: {} }));
  const [connecting, setConnecting] = useState<string | null>(null);

  const rows = sockets.data?.sockets ?? [];
  // Any other tool comes last, after the tools deevy knows by name.
  const offered = (providers.data?.providers ?? [])
    .filter((provider) => provider.id !== "stub")
    .sort((a, b) => Number(a.id === "generic") - Number(b.id === "generic"));
  // A tool nobody has walked yet is a Preview, wherever it is named here.
  const preview = new Set(
    (providers.data?.providers ?? []).filter((one) => !one.walked).map((one) => one.id),
  );

  return (
    <SettingsPage title="Sockets" description="The tools deevy is connected to, and works through.">
      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cable aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No tools connected yet</EmptyTitle>
            <EmptyDescription>
              deevy works in the tools your team already uses. Connect one, and bind a Project to a
              container inside it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsSection aria-label="Connected" title="Connected">
          <ul aria-label="Sockets" className="flex flex-col gap-2">
            {rows.map((socket) => {
              const standing = socketStanding(socket);
              return (
                <li key={socket.id}>
                  <Link
                    to="/settings/sockets/$socketId"
                    params={{ socketId: socket.id }}
                    className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent"
                  >
                    <Badge variant="outline">{providerLabel(socket.provider)}</Badge>
                    {preview.has(socket.provider) ? (
                      <Badge variant="secondary">Preview</Badge>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{socket.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {socket.identity.login ? `as ${socket.identity.login} · ` : ""}
                        {standing.text}
                      </span>
                    </span>
                    {socket.status !== "active" ? (
                      <Badge variant="outline">{socket.status}</Badge>
                    ) : null}
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      )}

      <SettingsSection
        aria-label="Connect a tool"
        title="Connect a tool"
        description={
          offered.some((provider) => preview.has(provider.id))
            ? "Preview means deevy is built and tested against that tool's recorded deliveries, and has not yet been tried against the tool itself."
            : undefined
        }
      >
        <div role="group" aria-label="Connect a tool" className="flex flex-wrap gap-2">
          {/* Only once the server has said: while the list is on its way, "no
              tools" is a claim about a deevy built with five. */}
          {providers.isSuccess && offered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This deevy was built with no tools it can connect.
            </p>
          ) : null}
          {offered.map((provider) => {
            // The label is the button's description, not its name: the name
            // is what a screen reader and a test find it by.
            const described = preview.has(provider.id) ? `preview-${provider.id}` : undefined;
            return (
              <Button
                key={provider.id}
                variant="outline"
                aria-describedby={described}
                onClick={() => setConnecting(provider.id)}
              >
                {provider.id === "generic" ? "Connect another tool" : `Connect ${provider.label}`}
                {described ? (
                  <Badge id={described} variant="secondary" aria-hidden>
                    Preview
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </div>
      </SettingsSection>

      <Dialog open={connecting !== null} onOpenChange={(open) => !open && setConnecting(null)}>
        {/* Scrolls inside the window rather than past it: Linear's names three
            addresses and three secrets, which is taller than a laptop screen. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {connecting === "generic"
                ? "Connect another tool"
                : `Connect ${providerLabel(connecting ?? undefined)}`}
            </DialogTitle>
            <DialogDescription>
              {connecting === "generic"
                ? "Any tool deevy has no Socket for, through an adapter you write that tells deevy what happens there."
                : "deevy holds one identity in each tool, and every Agent works through it."}
            </DialogDescription>
          </DialogHeader>
          {connecting === "generic" ? (
            <ConnectGeneric
              onConnected={() => {
                setConnecting(null);
                void client.invalidateQueries({ queryKey: orpc.sockets.key() });
              }}
            />
          ) : connecting === "github" ? (
            <ConnectGithub
              onConnected={() => {
                setConnecting(null);
                void client.invalidateQueries({ queryKey: orpc.sockets.key() });
              }}
            />
          ) : connecting === "gitlab" ? (
            <ConnectGitlab
              onConnected={() => {
                setConnecting(null);
                void client.invalidateQueries({ queryKey: orpc.sockets.key() });
              }}
            />
          ) : connecting === "linear" ? (
            <ConnectLinear
              onConnected={() => {
                setConnecting(null);
                void client.invalidateQueries({ queryKey: orpc.sockets.key() });
              }}
            />
          ) : connecting === "notion" ? (
            <ConnectNotion
              onConnected={() => {
                setConnecting(null);
                void client.invalidateQueries({ queryKey: orpc.sockets.key() });
              }}
            />
          ) : connecting === "slack" ? (
            <ConnectSlack
              onConnected={() => {
                setConnecting(null);
                void client.invalidateQueries({ queryKey: orpc.sockets.key() });
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Connecting {providerLabel(connecting ?? undefined)} arrives with its own module.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}

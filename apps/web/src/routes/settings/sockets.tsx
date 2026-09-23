import { Link } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Cable, ChevronRight } from "lucide-react";
import { ConnectGithub } from "@/components/connect-github";
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
  const offered = (providers.data?.providers ?? []).filter((provider) => provider.id !== "stub");

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

      <SettingsSection aria-label="Connect a tool" title="Connect a tool">
        <div role="group" aria-label="Connect a tool" className="flex flex-wrap gap-2">
          {offered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This deevy was built with no tools it can connect.
            </p>
          ) : null}
          {offered.map((provider) => (
            <Button key={provider.id} variant="outline" onClick={() => setConnecting(provider.id)}>
              Connect {provider.label}
            </Button>
          ))}
        </div>
      </SettingsSection>

      <Dialog open={connecting !== null} onOpenChange={(open) => !open && setConnecting(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Connect {providerLabel(connecting ?? undefined)}</DialogTitle>
            <DialogDescription>
              deevy holds one identity in each tool, and every Agent works through it.
            </DialogDescription>
          </DialogHeader>
          {connecting === "github" ? (
            <ConnectGithub
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

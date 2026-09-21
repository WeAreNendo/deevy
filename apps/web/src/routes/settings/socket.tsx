import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { socketStanding } from "@/routes/settings/sockets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NotFoundPage } from "@/routes/not-found";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";
import { providerLabel } from "@/lib/providers";

interface Delivery {
  id: string;
  deliveryId: string;
  eventName: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

/**
 * One Socket: is it talking to deevy, and what has it said (ADR-0024).
 *
 * The question this page answers is the one an operator actually has: whether
 * the tool is telling deevy things or deevy is having to go and ask. Both work
 * — polling is what keeps an instance no tool can reach running — but they are
 * different situations and a screen that hid which is which would be lying by
 * omission.
 */
export function SocketPage({ socketId }: { socketId: string }) {
  const client = useQueryClient();
  const sockets = useQuery(orpc.sockets.list.queryOptions({ input: {} }));
  const deliveries = useQuery(orpc.sockets.inbound.queryOptions({ input: { socketId } }));
  const [minted, setMinted] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const refresh = () => client.invalidateQueries({ queryKey: orpc.sockets.key() });
  const update = useMutation(orpc.sockets.update.mutationOptions({ onSuccess: refresh }));
  const rotate = useMutation(
    orpc.sockets.rotate.mutationOptions({
      onSuccess: async (answer) => {
        setMinted(answer.webhookSecret);
        await refresh();
      },
    }),
  );
  const check = useMutation(orpc.sockets.test.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(orpc.sockets.remove.mutationOptions({ onSuccess: refresh }));

  const socket = sockets.data?.sockets.find((row) => row.id === socketId);
  if (sockets.isPending) return <p className="text-muted-foreground">Loading the Socket…</p>;
  if (!socket) return <NotFoundPage what="Socket" />;

  const standing = socketStanding(socket);
  const quiet = standing.tone === "quiet" && socket.status === "active";
  const columns: DataColumn<Delivery>[] = [
    {
      id: "event",
      header: "Event",
      cell: (row) => <span className="font-mono text-xs">{row.eventName}</span>,
    },
    {
      id: "status",
      header: "What deevy made of it",
      cell: (row) => (
        <span className="flex items-center gap-2">
          <Badge variant="outline">{row.status}</Badge>
          {row.error ? (
            <span className="truncate text-xs text-muted-foreground">{row.error}</span>
          ) : null}
        </span>
      ),
      className: "max-w-0 min-w-0 overflow-hidden",
    },
    {
      id: "when",
      header: "When",
      cell: (row) => <span className="text-xs text-muted-foreground">{ago(row.createdAt)}</span>,
      sortValue: (row) => row.createdAt.getTime(),
    },
  ];

  return (
    <SettingsPage
      title={socket.name}
      description={`A ${providerLabel(socket.provider)} Socket${socket.identity.login ? `, as ${socket.identity.login}` : ""}.`}
    >
      <SettingsSection aria-label="How it is doing" title="How it is doing">
        <p className="text-sm">
          {standing.text}
          {quiet ? (
            <>
              {" · "}
              <span className="text-muted-foreground">
                deevy is asking it what changed rather than waiting to be told. That is the
                fallback, and it works; a tool that cannot reach this deevy stays on it.
              </span>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={check.isPending}
            onClick={() => check.mutate({ socketId })}
          >
            Ask who deevy is there
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                socketId,
                status: socket.status === "paused" ? "active" : "paused",
              })
            }
          >
            {socket.status === "paused" ? "Resume" : "Pause"}
          </Button>
        </div>
        {check.data ? (
          <p className="text-sm text-muted-foreground">It answers {check.data.identity.login}.</p>
        ) : null}
        {check.error ? <p className="text-sm text-destructive">{check.error.message}</p> : null}
      </SettingsSection>

      <SettingsSection
        aria-label="What it signs with"
        title="What it signs with"
        description="deevy checks every delivery against this. The tool needs the same one."
      >
        <p className="text-sm text-muted-foreground">
          {socket.hasWebhookSecret
            ? "There is one, and deevy will not show it again."
            : "There is none, so every delivery is refused."}
        </p>
        {minted ? (
          <p className="rounded-md border bg-card p-3 font-mono text-sm break-all">
            {minted}
            <span className="mt-1 block font-sans text-xs text-muted-foreground">
              This is the only time deevy will show it. Paste it into the tool now.
            </span>
          </p>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={rotate.isPending}
          onClick={() => rotate.mutate({ socketId })}
        >
          Mint a webhook secret
        </Button>
      </SettingsSection>

      <SettingsSection aria-label="Deliveries" title="What it has said lately">
        <DataTable
          aria-label="Deliveries"
          columns={columns}
          rows={(deliveries.data?.deliveries ?? []) as Delivery[]}
          getRowId={(row) => row.id}
          loading={deliveries.isPending}
          empty={{
            title: "Nothing yet",
            description: "A delivery shows up here the moment the tool speaks.",
          }}
        />
      </SettingsSection>

      <SettingsSection
        aria-label="Disconnect"
        title="Disconnect"
        description="What it projected stays readable. The credential goes."
        tone="danger"
      >
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          Disconnect
        </Button>
      </SettingsSection>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {socket.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The Issues it projected and the Runs on them stay. deevy drops the credential, stops
              taking deliveries, and the Projects bound to it have nothing to work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                remove.mutate({ socketId });
                setConfirming(false);
              }}
            >
              Disconnect it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}

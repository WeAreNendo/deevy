import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { socketStanding } from "@/routes/settings/sockets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { leaveFor } from "@/lib/leave";
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
  const install = useMutation(
    orpc.sockets.install.mutationOptions({ onSuccess: ({ url }) => leaveFor(url) }),
  );
  // Asked for only when somebody asks to see it: it is a secret, shown because
  // Notion wants it pasted back and for no longer than that (hooks.ts).
  const [revealing, setRevealing] = useState(false);
  const handshake = useQuery({
    ...orpc.sockets.handshake.queryOptions({ input: { socketId } }),
    enabled: revealing,
  });

  const socket = sockets.data?.sockets.find((row) => row.id === socketId);
  if (sockets.isPending) return <p className="text-muted-foreground">Loading the Socket…</p>;
  if (!socket) return <NotFoundPage what="Socket" />;

  const standing = socketStanding(socket);
  const config = socket.config as Record<string, unknown>;
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

      {socket.provider === "notion" ? (
        <SettingsSection
          aria-label="Verifying the webhook"
          title="Verifying the webhook"
          description="Notion sends a token when its webhook is made, and wants it pasted back."
        >
          {config.webhookVerified === true ? (
            <p className="text-sm text-muted-foreground">
              Notion has verified this webhook, and every delivery since is signed with its token.
            </p>
          ) : socket.hasWebhookSecret ? (
            <>
              <p className="text-sm text-muted-foreground">
                Notion sent its verification token. Paste it into Verify on the webhook in the
                integration&apos;s settings; the first delivery signed with it settles it.
              </p>
              {handshake.data?.token ? (
                <p className="rounded-md border bg-card p-3 font-mono text-sm break-all">
                  {handshake.data.token}
                </p>
              ) : (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={handshake.isFetching}
                    onClick={() => setRevealing(true)}
                  >
                    Show the token
                  </Button>
                </div>
              )}
              {handshake.error ? (
                <p className="text-sm text-destructive">{handshake.error.message}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting for Notion. Create a subscription in the integration&apos;s Webhooks, to this
              Socket&apos;s address, and the token Notion sends appears here.
            </p>
          )}
        </SettingsSection>
      ) : null}

      {socket.provider === "notion" ? (
        <SettingsSection
          aria-label="Who commented"
          title="Who commented"
          description="Notion has no account to link, so a ruling from a comment needs another proof."
        >
          <label className="flex items-center gap-3 text-sm">
            {/* Named by the label around it, which Base UI points it at. */}
            <Switch
              checked={config.identityByEmail === true}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({ socketId, identityByEmail: checked === true })
              }
            />
            Take a verified address as proof
          </label>
          <p className="text-xs text-muted-foreground">
            A comment counts as a Member&apos;s when Notion reports an address they verified in
            deevy. That is weaker than a linked account, and every ruling it makes says
            &ldquo;(email)&rdquo;.
          </p>
        </SettingsSection>
      ) : null}

      {socket.provider === "linear" && socket.status !== "pending" ? (
        <SettingsSection
          aria-label="Assigning issues to deevy"
          title="Assigning issues to deevy"
          description="Each issue assigned to deevy goes to the Project's default Agent."
        >
          {config.assignable === true ? (
            <p className="text-sm text-muted-foreground">
              People can assign an issue to deevy in Linear. It shows as the issue&apos;s delegate,
              and whoever assigned it stays its assignee.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                A Linear admin installs deevy as an agent once, on Linear&apos;s own page. Until
                then a label is the only way to hand an issue to an Agent.
              </p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={install.isPending}
                  onClick={() => install.mutate({ socketId })}
                >
                  Install deevy as an agent
                </Button>
              </div>
              {install.error ? (
                <p className="text-sm text-destructive">{install.error.message}</p>
              ) : null}
            </>
          )}
        </SettingsSection>
      ) : null}

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

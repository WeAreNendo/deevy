import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { socketStanding } from "@/routes/settings/sockets";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { SecretInput } from "@/components/secret-input";
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
import { webHref } from "@/lib/href";
import { leaveFor } from "@/lib/leave";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";
import { providerLabel } from "@/lib/providers";
import { cn } from "@/lib/utils";

/**
 * Where each tool keeps the secret it signs with, said beside the field that
 * takes a new one.
 *
 * Copy only. Whether the page offers that field, Mint, or neither is the
 * provider's own word — `webhookSecretFrom` in `sockets.providers`, which
 * `sockets.rotate` decides by too — so the page and the server cannot
 * disagree, and a tool with no sentence here still gets the right controls:
 * `tool` (Slack, Linear) takes only the tool's, `either` (GitHub, GitLab)
 * takes the tool's or mints one, and `handshake` (Notion) has no section,
 * since "Verifying the webhook" is where its token is.
 *
 * Either way the one replaced is still taken for a day (`PREVIOUS_SECRET_MS`
 * in the core's hooks.ts), so the two sides can change in either order.
 */
const whereItIsMade: Record<string, string> = {
  slack:
    "Slack makes it: the Signing Secret, under Basic Information in the app's settings. When you regenerate it there, paste the new one here.",
  linear:
    "Linear makes it: the signing secret on the webhook in your OAuth application's settings. When it changes there, paste the new one here.",
  github:
    "It is the webhook secret in the App's settings on GitHub. Type a new one there and paste it here, or mint one here and paste it there.",
  gitlab:
    "It is the secret token on each webhook in GitLab, or the signing token GitLab generated on it. Paste a new one from GitLab here, or mint a secret token here and paste it into each webhook.",
};

/** The tool's own sentence, or one that fits who makes the secret. */
function madeWhere(provider: string, from: "either" | "tool", tool: string): string {
  return (
    whereItIsMade[provider] ??
    (from === "tool"
      ? `${tool} makes it. When it changes there, paste the new one here.`
      : `Paste a new one from ${tool} here, or mint one here and paste it into ${tool}.`)
  );
}

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
  // What each tool says of itself, here who makes its webhook secret.
  const providers = useQuery(orpc.sockets.providers.queryOptions({ input: {} }));
  const deliveries = useQuery(orpc.sockets.inbound.queryOptions({ input: { socketId } }));
  const [minted, setMinted] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const refresh = () => client.invalidateQueries({ queryKey: orpc.sockets.key() });
  const update = useMutation(orpc.sockets.update.mutationOptions({ onSuccess: refresh }));
  // Apart from `update`, so a secret saved and a Socket paused say so each in
  // their own place. Whichever of a pasted and a minted secret came last is
  // the one the section talks about.
  const [replacement, setReplacement] = useState("");
  const replace = useMutation(
    orpc.sockets.update.mutationOptions({
      onSuccess: async () => {
        setReplacement("");
        setMinted(null);
        await refresh();
      },
    }),
  );
  const rotate = useMutation(
    orpc.sockets.rotate.mutationOptions({
      onSuccess: async (answer) => {
        replace.reset();
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
  const rewire = useMutation(orpc.sockets.rewire.mutationOptions());
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
  const tool = providerLabel(socket.provider);
  // Undefined until the server has said, and where it could not: the section
  // then says only whether there is a secret, and offers nothing to change it.
  const from = providers.data?.providers.find(
    (one) => one.id === socket.provider,
  )?.webhookSecretFrom;
  const signing =
    providers.isPending || from === "handshake"
      ? null
      : {
          made:
            from === "tool" || from === "either" ? madeWhere(socket.provider, from, tool) : null,
          mint: from === "either",
        };
  const config = socket.config as Record<string, unknown>;
  // Where a GitHub App is installed: an account per installation, written by
  // the install's redirect and by GitHub's own `installation` delivery.
  const installations = Array.isArray(config.installations)
    ? (config.installations as Array<{ id?: unknown; account?: unknown }>).map((one) => ({
        id: typeof one.id === "string" || typeof one.id === "number" ? String(one.id) : "",
        account: typeof one.account === "string" ? one.account : "",
      }))
    : [];
  // What GitHub said the App's page is, and only if it is a web page: it is
  // drawn as a link below (lib/href.ts).
  const htmlUrl = typeof config.htmlUrl === "string" ? webHref(config.htmlUrl) : undefined;
  const appPage = htmlUrl
    ? htmlUrl.replace(/\/+$/, "")
    : typeof config.slug === "string"
      ? `https://github.com/apps/${config.slug}`
      : null;
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
        aria-label="Where it delivers"
        title="Where it delivers"
        description="The address the tool sends what happens to. It is not a secret."
      >
        <p className="rounded-md border bg-card p-3 font-mono text-sm break-all">
          {socket.inboundUrl}
        </p>
        {socket.provider === "github" ? (
          <>
            <p className="text-sm text-muted-foreground">
              When this deevy&apos;s address changes — a tunnel with a new hostname — deevy can
              point the App&apos;s webhook here itself.
            </p>
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={rewire.isPending}
                onClick={() => rewire.mutate({ socketId })}
              >
                Point GitHub at this address
              </Button>
            </div>
            {rewire.isSuccess ? (
              <p className="text-sm text-muted-foreground">GitHub delivers here now.</p>
            ) : null}
            {rewire.error ? (
              <p className="text-sm text-destructive">{rewire.error.message}</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            When this deevy&apos;s address changes, paste it into the tool&apos;s webhook settings
            again. Until then deevy goes and asks the tool what changed, so nothing is lost.
          </p>
        )}
      </SettingsSection>

      {socket.provider === "github" && socket.status !== "pending" ? (
        <SettingsSection
          aria-label="Where it is installed"
          title="Where it is installed"
          description="A GitHub App works only the repositories it is installed on, and installing it is GitHub's to do."
        >
          {installations.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {installations.map((one) => (
                <li key={one.id}>
                  <Badge variant="outline">{one.account || one.id}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Installed nowhere yet, so it can see no repository and no Project can be bound to it.
            </p>
          )}
          {appPage ? (
            <div>
              <a
                href={`${appPage}/installations/new`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {installations.length > 0 ? "Install it on more repositories" : "Install it"}
              </a>
            </div>
          ) : null}
        </SettingsSection>
      ) : null}

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
                Notion sent its verification token. Paste it into Verify on the connection&apos;s
                Webhooks tab in Notion; the first delivery signed with it settles it.
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
              Waiting for Notion. Create a subscription on the connection&apos;s Webhooks tab, to
              this Socket&apos;s address, and the token Notion sends appears here.
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
          {/* The mark is the Gate page's list of decisions (gates/gate.tsx), and
              only there: Slack, the feed and the tracker's comment name the
              Human without it, so the sentence says where to look. */}
          <p className="text-xs text-muted-foreground">
            A comment counts as a Member&apos;s when Notion reports an address they verified in
            deevy. That is weaker than a linked account, so the Gate&apos;s page marks every ruling
            made this way &ldquo;(email)&rdquo;.
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

      {signing ? (
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
          {signing.made ? (
            <>
              <p className="text-sm text-muted-foreground">{signing.made}</p>
              <Field>
                <FieldLabel htmlFor="socket-new-secret">New secret from {tool}</FieldLabel>
                <div className="flex flex-col gap-2 @md:flex-row">
                  <SecretInput
                    id="socket-new-secret"
                    className="@md:flex-1"
                    value={replacement}
                    onChange={(changed) => setReplacement(changed.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="w-fit"
                    disabled={!replacement.trim() || replace.isPending}
                    onClick={() => replace.mutate({ socketId, webhookSecret: replacement.trim() })}
                  >
                    Use the new secret
                  </Button>
                </div>
                <FieldDescription>
                  deevy keeps taking the old one for a day after, so it does not matter which side
                  changes first.
                </FieldDescription>
              </Field>
              {replace.isSuccess ? (
                <p className="text-sm text-muted-foreground">
                  deevy checks deliveries against the new one now, and takes the old one for a day
                  more.
                </p>
              ) : null}
              {replace.error ? (
                <p className="text-sm text-destructive">{replace.error.message}</p>
              ) : null}
            </>
          ) : null}
          {signing.mint ? (
            // Apart from the field above where there is one: the other way round.
            <div className={cn("flex flex-col gap-3", signing.made && "border-t pt-3")}>
              {minted ? (
                <p className="rounded-md border bg-card p-3 font-mono text-sm break-all">
                  {minted}
                  <span className="mt-1 block font-sans text-xs text-muted-foreground">
                    This is the only time deevy will show it. Paste it into {tool}: deevy takes the
                    old one for a day more, so nothing {tool} sends meanwhile is refused.
                  </span>
                </p>
              ) : null}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rotate.isPending}
                  onClick={() => rotate.mutate({ socketId })}
                >
                  Mint a webhook secret
                </Button>
              </div>
              {rotate.error ? (
                <p className="text-sm text-destructive">{rotate.error.message}</p>
              ) : null}
            </div>
          ) : null}
        </SettingsSection>
      ) : null}

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

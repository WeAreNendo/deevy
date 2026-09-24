import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { leaveFor } from "@/lib/leave";
import { orpc } from "@/lib/orpc";

/**
 * Connecting Linear (ADR-0024, docs/OPERATIONS.md "Connecting Linear").
 *
 * deevy acts in Linear as an OAuth application of the Workspace's own, so the
 * operator makes one in Linear and pastes its client back. Linear wants three
 * of deevy's addresses written into that application, and two of them name the
 * Socket — so the Socket is started first and the addresses are shown with
 * their real values, as Slack's manifest is.
 */

/** One address to copy, as mono text that wraps rather than widening the dialog. */
function Address({ children }: { children: string }) {
  return (
    <p className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">{children}</p>
  );
}

export function ConnectLinear({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");

  const begin = useMutation(orpc.sockets.begin.mutationOptions());
  const connect = useMutation(orpc.sockets.connect.mutationOptions());
  const install = useMutation(
    orpc.sockets.install.mutationOptions({ onSuccess: ({ url }) => leaveFor(url) }),
  );
  const begun = begin.data;
  const connected = connect.data;

  if (connected) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Connected as <span className="font-medium">{connected.identity.login}</span>. Label an
          issue <code>agent:&lt;handle&gt;</code> in a team you bind to a Project, and that Agent
          takes it.
        </p>
        <p className="text-sm text-muted-foreground">
          To let people assign an issue to deevy as well, a Linear admin installs it as an agent.
          Each issue assigned to it goes to the Project&apos;s default Agent.
        </p>
        {install.error ? <p className="text-sm text-destructive">{install.error.message}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={install.isPending}
            onClick={() => install.mutate({ socketId: connected.id })}
          >
            Install deevy as an agent
          </Button>
          <Button onClick={onConnected}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="linear-name">Name</FieldLabel>
        <Input
          id="linear-name"
          value={name}
          placeholder="Acme on Linear"
          disabled={begun !== undefined}
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>What this connection is called in deevy.</FieldDescription>
      </Field>

      {begun === undefined ? (
        <div>
          <Button
            disabled={!name.trim() || begin.isPending}
            onClick={() => begin.mutate({ provider: "linear", name: name.trim() })}
          >
            Show the addresses
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            In Linear, open Settings → API →{" "}
            <a
              href="https://linear.app/settings/api/applications/new"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              New OAuth application
            </a>
            , and turn on <span className="font-medium">Client credentials</span>.
          </p>
          <Field>
            <FieldLabel>Callback URLs</FieldLabel>
            <div aria-label="Callback URLs" className="flex flex-col gap-1">
              <Address>{begun.accountCallbackUrl}</Address>
              <Address>{begun.setupUrl}</Address>
            </div>
            <FieldDescription>
              Both of them, one per line: the first is where people come back after linking their
              Linear account, the second where an admin comes back after installing deevy.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Webhook URL</FieldLabel>
            <Address>{begun.inboundUrl}</Address>
            <FieldDescription>
              Turn on webhooks, paste this, and choose Issues and Comments.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="linear-client-id">Client ID</FieldLabel>
            <Input
              id="linear-client-id"
              value={clientId}
              onChange={(changed) => setClientId(changed.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="linear-client-secret">Client secret</FieldLabel>
            <Input
              id="linear-client-secret"
              value={clientSecret}
              onChange={(changed) => setClientSecret(changed.target.value)}
            />
            <FieldDescription>deevy seals it and never shows it again.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="linear-signing-secret">Webhook signing secret</FieldLabel>
            <Input
              id="linear-signing-secret"
              value={signingSecret}
              onChange={(changed) => setSigningSecret(changed.target.value)}
            />
            <FieldDescription>
              Beside the webhook. Without it deevy cannot tell Linear from anybody else.
            </FieldDescription>
          </Field>
          {connect.error ? (
            <p className="text-sm text-destructive">{connect.error.message}</p>
          ) : null}
          <div>
            <Button
              disabled={
                !clientId.trim() ||
                !clientSecret.trim() ||
                !signingSecret.trim() ||
                connect.isPending
              }
              onClick={() =>
                connect.mutate({
                  provider: "linear",
                  name: name.trim(),
                  socketId: begun.id,
                  credentials: { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
                  webhookSecret: signingSecret.trim(),
                })
              }
            >
              Connect
            </Button>
          </div>
        </>
      )}
      {begin.error ? <p className="text-sm text-destructive">{begin.error.message}</p> : null}
    </div>
  );
}

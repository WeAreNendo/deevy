import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc";

/**
 * Connecting Notion (ADR-0024, docs/OPERATIONS.md "Working in Notion").
 *
 * deevy acts in Notion as an internal integration of the workspace's own, so
 * the operator makes one and pastes its secret. Notion's webhook is made on
 * Notion's side after that, and Notion answers it with a token of its own that
 * has to be pasted back into Notion — which deevy receives, and the Socket's
 * page shows, so this dialog only says where to point it.
 */
export function ConnectNotion({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const connect = useMutation(orpc.sockets.connect.mutationOptions());
  const connected = connect.data;

  if (connected) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Connected as <span className="font-medium">{connected.identity.login}</span>. In the
          integration&apos;s settings in Notion, open Webhooks and create a subscription to this
          address, for pages and comments:
        </p>
        <p className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
          {connected.inboundUrl}
        </p>
        <p className="text-sm text-muted-foreground">
          Notion then sends deevy a verification token. It appears on the Socket&apos;s page, for
          you to paste into Notion&apos;s Verify. Share each database deevy should read with the
          integration, from the database&apos;s own Connections menu.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/settings/sockets/$socketId"
            params={{ socketId: connected.id }}
            className={buttonVariants({ variant: "outline" })}
            onClick={onConnected}
          >
            Open the Socket&apos;s page
          </Link>
          <Button onClick={onConnected}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="notion-name">Name</FieldLabel>
        <Input
          id="notion-name"
          value={name}
          placeholder="Acme's Notion"
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>What this connection is called in deevy.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="notion-secret">Internal integration secret</FieldLabel>
        <Input
          id="notion-secret"
          value={secret}
          placeholder="ntn_…"
          onChange={(changed) => setSecret(changed.target.value)}
        />
        <FieldDescription>
          From an internal integration in Notion — Settings → Connections → Develop or manage
          integrations — with read content, update content, insert content, read comments, insert
          comments and user information including email addresses. deevy seals it and never shows it
          again.
        </FieldDescription>
      </Field>
      {connect.error ? <p className="text-sm text-destructive">{connect.error.message}</p> : null}
      <div>
        <Button
          disabled={!name.trim() || !secret.trim() || connect.isPending}
          onClick={() =>
            connect.mutate({
              provider: "notion",
              name: name.trim(),
              credentials: { token: secret.trim() },
            })
          }
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

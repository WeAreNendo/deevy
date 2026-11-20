import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc";

/**
 * Connecting any other tool (docs/plans/simplify.md, slice 7).
 *
 * There is nothing to paste: the tool is reached by an adapter the team
 * writes, which posts deevy's own format to the Socket's address and signs it
 * with a secret deevy mints at connect. So this dialog takes a name, then
 * shows the address and that secret, once.
 */

/** The public page that says what an adapter sends and how to sign it. */
const FORMAT = "https://docs.deevy.dev/tools/generic/";

/** One address or secret to copy, as mono text that wraps rather than widening the dialog. */
function Copyable({ children }: { children: string }) {
  return (
    <p className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">{children}</p>
  );
}

export function ConnectGeneric({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState("");
  const connect = useMutation(orpc.sockets.connect.mutationOptions());
  const connected = connect.data;

  if (connected) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Your adapter posts each delivery to this address, signed with this secret. The format and
          a signing example are on the page that says{" "}
          <a href={FORMAT} target="_blank" rel="noreferrer" className="underline">
            what a delivery says
          </a>
          .
        </p>
        <Field>
          <FieldLabel>URL</FieldLabel>
          <Copyable>{connected.inboundUrl}</Copyable>
        </Field>
        <Field>
          <FieldLabel>Webhook secret</FieldLabel>
          {connected.webhookSecret ? <Copyable>{connected.webhookSecret}</Copyable> : null}
          <FieldDescription>
            This is the only time deevy shows it. You can mint a new one on the Socket&apos;s page.
          </FieldDescription>
        </Field>
        <p className="text-sm text-muted-foreground">
          A Ruling sent this way never counts, because whoever holds the secret could have written
          it: a Gate on a record from this tool is ruled on in deevy.
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
        <FieldLabel htmlFor="generic-name">Name</FieldLabel>
        <Input
          id="generic-name"
          value={name}
          placeholder="Acme's Jira"
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>What this Socket is called in deevy.</FieldDescription>
      </Field>
      {connect.error ? <p className="text-sm text-destructive">{connect.error.message}</p> : null}
      <div>
        <Button
          disabled={!name.trim() || connect.isPending}
          onClick={() => connect.mutate({ provider: "generic", name: name.trim() })}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

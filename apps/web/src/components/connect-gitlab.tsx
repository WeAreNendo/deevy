import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc";

/**
 * Connecting GitLab (ADR-0024, docs/OPERATIONS.md "Working in GitLab").
 *
 * deevy acts on GitLab as one user — a dedicated account, or the bot a project
 * or group access token makes — through a token pasted here. GitLab's webhook
 * is set up on GitLab's side, so once the token has proved itself deevy mints
 * the secret token it will check deliveries against and shows it once, beside
 * the address; or takes GitLab's own signing token instead, which signs each
 * delivery rather than carrying the secret in it.
 */

const GITLAB_COM = "https://gitlab.com";

/** One address or secret to copy, as mono text that wraps rather than widening the dialog. */
function Copyable({ children }: { children: string }) {
  return (
    <p className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">{children}</p>
  );
}

export function ConnectGitlab({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(GITLAB_COM);
  const [token, setToken] = useState("");
  const [signingToken, setSigningToken] = useState("");

  const rotate = useMutation(orpc.sockets.rotate.mutationOptions());
  const connect = useMutation(
    orpc.sockets.connect.mutationOptions({
      // The secret token is deevy's to choose, and there is nothing to check a
      // delivery against until there is one.
      onSuccess: (socket) => rotate.mutate({ socketId: socket.id }),
    }),
  );
  const update = useMutation(orpc.sockets.update.mutationOptions({ onSuccess: onConnected }));
  const connected = connect.data;
  const instance = baseUrl.trim().replace(/\/+$/, "");

  if (connected) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Connected as <span className="font-medium">{connected.identity.login}</span>. Now add a
          webhook to each project or group you bind — Settings → Webhooks in GitLab — with Issues
          events and Comments.
        </p>
        <Field>
          <FieldLabel>URL</FieldLabel>
          <Copyable>{connected.inboundUrl}</Copyable>
        </Field>
        <Field>
          <FieldLabel>Secret token</FieldLabel>
          {rotate.data ? (
            <Copyable>{rotate.data.webhookSecret}</Copyable>
          ) : (
            <p className="text-sm text-muted-foreground">Minting one…</p>
          )}
          <FieldDescription>
            This is the only time deevy shows it. GitLab sends it with every delivery.
          </FieldDescription>
        </Field>
        {rotate.error ? <p className="text-sm text-destructive">{rotate.error.message}</p> : null}
        <Field>
          <FieldLabel htmlFor="gitlab-signing-token">Signing token</FieldLabel>
          <Input
            id="gitlab-signing-token"
            value={signingToken}
            placeholder="whsec_…"
            onChange={(changed) => setSigningToken(changed.target.value)}
          />
          <FieldDescription>
            Or leave the secret token out, generate a signing token on the webhook instead, and
            paste it here: GitLab then signs each delivery rather than sending the secret with it.
          </FieldDescription>
        </Field>
        {update.error ? <p className="text-sm text-destructive">{update.error.message}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!signingToken.trim() || update.isPending}
            onClick={() =>
              update.mutate({ socketId: connected.id, webhookSecret: signingToken.trim() })
            }
          >
            Use the signing token
          </Button>
          <Button onClick={onConnected}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="gitlab-name">Name</FieldLabel>
        <Input
          id="gitlab-name"
          value={name}
          placeholder="Acme on GitLab"
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>What this connection is called in deevy.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="gitlab-url">GitLab URL</FieldLabel>
        <Input
          id="gitlab-url"
          value={baseUrl}
          onChange={(changed) => setBaseUrl(changed.target.value)}
        />
        <FieldDescription>Change it for a GitLab of your own.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="gitlab-token">Access token</FieldLabel>
        <Input
          id="gitlab-token"
          value={token}
          placeholder="glpat-…"
          onChange={(changed) => setToken(changed.target.value)}
        />
        <FieldDescription>
          A personal, project or group access token with the <code>api</code> scope, for the user
          deevy should comment, push and open merge requests as. Give that user Developer on the
          projects it works. deevy seals the token and never shows it again.
        </FieldDescription>
      </Field>
      {connect.error ? <p className="text-sm text-destructive">{connect.error.message}</p> : null}
      <div>
        <Button
          disabled={!name.trim() || !token.trim() || !instance || connect.isPending}
          onClick={() =>
            connect.mutate({
              provider: "gitlab",
              name: name.trim(),
              config: instance === GITLAB_COM ? {} : { baseUrl: instance },
              credentials: { token: token.trim() },
            })
          }
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

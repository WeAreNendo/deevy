import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SecretInput } from "@/components/secret-input";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc";
import manifestTemplate from "../../../../docs/slack-manifest.yaml?raw";

/**
 * Connecting a Slack app (ADR-0025, `docs/slack-manifest.yaml`).
 *
 * Slack wants the address it will send clicks to written into the app's own
 * manifest, and that address names the Socket — so the Socket is started
 * first, the manifest is shown with the real address in it, and the token and
 * signing secret Slack then shows are pasted back to finish it. One trip to
 * Slack instead of two.
 */

/** The committed manifest, with this instance's request URL where the placeholder is. */
export function slackManifest(requestUrl: string): string {
  return manifestTemplate
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .replaceAll("https://deevy.example.com/hooks/SOCKET_ID", requestUrl)
    .trim();
}

export function ConnectSlack({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [begun, setBegun] = useState<{ id: string; manifest: string } | null>(null);

  const begin = useMutation(
    orpc.sockets.begin.mutationOptions({
      onSuccess: (socket) =>
        setBegun({ id: socket.id, manifest: slackManifest(socket.inboundUrl) }),
    }),
  );
  const connect = useMutation(orpc.sockets.connect.mutationOptions({ onSuccess: onConnected }));

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="slack-name">Name</FieldLabel>
        <Input
          id="slack-name"
          value={name}
          placeholder="Acme's Slack"
          disabled={begun !== null}
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>What this Socket is called in deevy.</FieldDescription>
      </Field>

      {begun === null ? (
        <div>
          <Button
            disabled={!name.trim() || begin.isPending}
            onClick={() => begin.mutate({ provider: "slack", name: name.trim() })}
          >
            Show the app manifest
          </Button>
        </div>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor="slack-manifest">App manifest</FieldLabel>
            <pre
              id="slack-manifest"
              aria-label="App manifest"
              // Wrapped rather than scrolled sideways: a long line would
              // otherwise widen the dialog past its own edge. Copying takes
              // the text as written.
              className="max-h-56 min-w-0 overflow-y-auto rounded-md border bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap"
            >
              {begun.manifest}
            </pre>
            <FieldDescription>
              In Slack, choose{" "}
              <a
                href="https://api.slack.com/apps?new_app=1"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Create New App
              </a>{" "}
              → From an app manifest, paste this, and install the app to your workspace.
            </FieldDescription>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(begun.manifest);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy the manifest"}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="slack-token">Bot User OAuth Token</FieldLabel>
            <SecretInput
              id="slack-token"
              value={botToken}
              placeholder="xoxb-…"
              onChange={(changed) => setBotToken(changed.target.value)}
            />
            <FieldDescription>
              Under OAuth &amp; Permissions once the app is installed. deevy seals it and never
              shows it again.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="slack-secret">Signing Secret</FieldLabel>
            <SecretInput
              id="slack-secret"
              value={signingSecret}
              onChange={(changed) => setSigningSecret(changed.target.value)}
            />
            <FieldDescription>
              Under Basic Information. Without it deevy cannot tell a click from anybody
              else&apos;s.
            </FieldDescription>
          </Field>
          {connect.error ? (
            <p className="text-sm text-destructive">{connect.error.message}</p>
          ) : null}
          <div>
            <Button
              disabled={!botToken.trim() || !signingSecret.trim() || connect.isPending}
              onClick={() =>
                connect.mutate({
                  provider: "slack",
                  name: name.trim(),
                  socketId: begun.id,
                  credentials: { botToken: botToken.trim() },
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

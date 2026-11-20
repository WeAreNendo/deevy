import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SecretInput } from "@/components/secret-input";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc";
import manifestTemplate from "../../../../docs/slack-manifest.yaml?raw";

/**
 * Connecting a Slack app (ADR-0036, `docs/slack-manifest.yaml`).
 *
 * deevy only posts in Slack, and Slack sends it nothing, so the app has no
 * address of deevy's in it: the manifest is shown as it is committed, the app
 * is made and installed from it, and the bot token Slack then shows is pasted
 * back. One trip to Slack, and nothing to sign.
 */

/** The committed manifest, as Slack takes it: without the comments that explain it. */
export function slackManifest(): string {
  return manifestTemplate
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

export function ConnectSlack({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [copied, setCopied] = useState(false);
  const manifest = slackManifest();

  const connect = useMutation(orpc.sockets.connect.mutationOptions({ onSuccess: onConnected }));

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="slack-name">Name</FieldLabel>
        <Input
          id="slack-name"
          value={name}
          placeholder="Acme's Slack"
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>What this Socket is called in deevy.</FieldDescription>
      </Field>
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
          {manifest}
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
          → From a manifest, paste this, and install the app to your workspace.
        </FieldDescription>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(manifest);
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
          Under OAuth &amp; Permissions once the app is installed. deevy seals it and never shows it
          again.
        </FieldDescription>
      </Field>
      {connect.error ? <p className="text-sm text-destructive">{connect.error.message}</p> : null}
      <div>
        <Button
          disabled={!name.trim() || !botToken.trim() || connect.isPending}
          onClick={() =>
            connect.mutate({
              provider: "slack",
              name: name.trim(),
              credentials: { botToken: botToken.trim() },
            })
          }
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

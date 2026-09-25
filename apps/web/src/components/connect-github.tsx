import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SecretInput } from "@/components/secret-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc";

/**
 * Connecting GitHub (ADR-0024).
 *
 * Two ways in, and the first is the one to take: deevy writes the App's
 * manifest, GitHub makes the App from it, and the credentials come back
 * without anybody copying a private key out of a browser. The second is for an
 * App that already exists — an organisation that makes them centrally, or a
 * second deevy pointed at the same one.
 *
 * The manifest is posted to GitHub by the browser, so this is a real form with
 * a real action: deevy never sees the round trip, and the `state` is what
 * proves the redirect that lands afterwards started here (secrets.ts).
 */
export interface GithubManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  setup_url: string;
  public: boolean;
  default_events: string[];
  default_permissions: Record<string, string>;
}

/**
 * What deevy asks GitHub for, and nothing more. Issues to read and write the
 * records, contents and pull requests for the forge an Agent pushes through,
 * metadata because GitHub requires it.
 */
export function githubManifest(input: {
  name: string;
  deevyUrl: string;
  inboundUrl: string;
  setupUrl: string;
}): GithubManifest {
  return {
    name: input.name,
    url: input.deevyUrl,
    hook_attributes: { url: input.inboundUrl, active: true },
    redirect_url: input.setupUrl,
    setup_url: input.setupUrl,
    public: false,
    default_events: ["issues", "issue_comment", "sub_issues", "label", "repository"],
    default_permissions: {
      issues: "write",
      metadata: "read",
      contents: "write",
      pull_requests: "write",
    },
  };
}

export function ConnectGithub({ onConnected }: { onConnected: () => void }) {
  const [paste, setPaste] = useState(false);
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [begun, setBegun] = useState<{
    manifest: GithubManifest;
    state: string;
  } | null>(null);

  const begin = useMutation(
    orpc.sockets.begin.mutationOptions({
      onSuccess: (socket) => {
        setBegun({
          manifest: githubManifest({
            name: name.trim(),
            deevyUrl: window.location.origin,
            inboundUrl: socket.inboundUrl,
            setupUrl: socket.setupUrl,
          }),
          state: socket.state,
        });
      },
    }),
  );
  const connect = useMutation(orpc.sockets.connect.mutationOptions({ onSuccess: onConnected }));

  if (paste) {
    return (
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="github-name">Name</FieldLabel>
          <Input
            id="github-name"
            value={name}
            placeholder="acme on GitHub"
            onChange={(changed) => setName(changed.target.value)}
          />
          <FieldDescription>What this connection is called in deevy.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="github-app-id">App id</FieldLabel>
          <Input
            id="github-app-id"
            value={appId}
            placeholder="1284461"
            onChange={(changed) => setAppId(changed.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="github-key">Private key</FieldLabel>
          <Textarea
            id="github-key"
            rows={4}
            value={privateKey}
            placeholder="-----BEGIN RSA PRIVATE KEY-----"
            onChange={(changed) => setPrivateKey(changed.target.value)}
          />
          <FieldDescription>
            The .pem GitHub gave you, whole. deevy seals it and never shows it again.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="github-webhook">Webhook secret</FieldLabel>
          <SecretInput
            id="github-webhook"
            value={webhookSecret}
            placeholder="whsec_…"
            onChange={(changed) => setWebhookSecret(changed.target.value)}
          />
          <FieldDescription>
            The one on the App&apos;s own settings page. Without it deevy cannot tell a delivery
            from anybody else&apos;s.
          </FieldDescription>
        </Field>
        {connect.error ? <p className="text-sm text-destructive">{connect.error.message}</p> : null}
        <div className="flex items-center gap-2">
          <Button
            disabled={!name.trim() || !appId.trim() || !privateKey.trim() || connect.isPending}
            onClick={() =>
              connect.mutate({
                provider: "github",
                name: name.trim(),
                config: { appId: appId.trim() },
                credentials: { privateKey },
                ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
              })
            }
          >
            Connect
          </Button>
          <Button variant="ghost" onClick={() => setPaste(false)}>
            Make a new App instead
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="github-name">Name</FieldLabel>
        <Input
          id="github-name"
          value={name}
          placeholder="acme on GitHub"
          onChange={(changed) => setName(changed.target.value)}
        />
        <FieldDescription>
          GitHub uses it to name the App, and deevy to name this connection.
        </FieldDescription>
      </Field>

      {begun ? (
        // A real form, posted by the browser: GitHub takes the manifest, makes
        // the App, and sends the operator back to deevy with a one-use code.
        <form
          aria-label="Create the App on GitHub"
          method="post"
          action={`https://github.com/settings/apps/new?state=${encodeURIComponent(begun.state)}`}
          className="flex flex-col gap-2"
        >
          <input
            type="hidden"
            name="manifest"
            data-testid="manifest"
            value={JSON.stringify(begun.manifest)}
          />
          <p className="text-sm text-muted-foreground">
            deevy has the name. GitHub makes the App and sends you straight back.
          </p>
          <Button type="submit" className="w-fit">
            Continue on GitHub
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            disabled={!name.trim() || begin.isPending}
            onClick={() => begin.mutate({ provider: "github", name: name.trim() })}
          >
            Create the App on GitHub
          </Button>
          <Button variant="ghost" onClick={() => setPaste(true)}>
            Paste an App you already have
          </Button>
        </div>
      )}
      {begin.error ? <p className="text-sm text-destructive">{begin.error.message}</p> : null}
    </div>
  );
}

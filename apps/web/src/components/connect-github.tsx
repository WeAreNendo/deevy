import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SecretInput } from "@/components/secret-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc";
import { appURL } from "@/lib/base";

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
 *
 * The App is private, and GitHub installs a private App only on the account
 * that owns it. Posted to `settings/apps/new` it is the person's own, which no
 * organization's repository can install, so naming an organization posts it to
 * that organization's settings instead and the App is the organization's.
 * Nothing after the redirect cares which: the conversion answers the App's own
 * page either way, and its install page offers whichever account owns it.
 *
 * Only on github.com, though: the page's policy lets a form go nowhere else
 * (packages/core/src/headers.ts), so where this deevy's GitHub is a GitHub
 * Enterprise Server or GHE.com the server says it will not begin
 * (`beginRefusal` in `sockets.providers`) and the paste is the only way in.
 * Which of the two it is, the dialog waits to hear rather than guessing: a
 * Create offered before the answer would be a form the browser then refuses.
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

/**
 * Whether GitHub would take this as an account's login: letters, digits and
 * single hyphens, neither first nor last, and at most 39 of them — GitHub's
 * own rule, the same for a user and an organization.
 */
export function isGithubLogin(value: string): boolean {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value);
}

/**
 * Where the manifest is posted: the person's own settings, or an
 * organization's, which GitHub opens only to its owners and its App managers.
 */
export function manifestAction(state: string, organization?: string): string {
  const settings = organization
    ? `organizations/${encodeURIComponent(organization)}/settings`
    : "settings";
  return `https://github.com/${settings}/apps/new?state=${encodeURIComponent(state)}`;
}

export function ConnectGithub({ onConnected }: { onConnected: () => void }) {
  const [paste, setPaste] = useState(false);
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [begun, setBegun] = useState<{
    manifest: GithubManifest;
    state: string;
    /** The organization the App is made on; undefined for the person's own account. */
    organization: string | undefined;
  } | null>(null);
  const owner = organization.trim();
  const ownerInvalid = owner !== "" && !isGithubLogin(owner);
  // The same answer the Sockets page offered this dialog from, so it is here
  // already: whether deevy can make the App on this deevy's GitHub at all.
  const providers = useQuery(orpc.sockets.providers.queryOptions({ input: {} }));
  const pasteOnly = Boolean(
    providers.data?.providers.find((provider) => provider.id === "github")?.beginRefusal,
  );

  const begin = useMutation(
    orpc.sockets.begin.mutationOptions({
      onSuccess: (socket) => {
        setBegun({
          manifest: githubManifest({
            name: name.trim(),
            deevyUrl: appURL(""),
            inboundUrl: socket.inboundUrl,
            setupUrl: socket.setupUrl,
          }),
          state: socket.state,
          organization: owner || undefined,
        });
      },
    }),
  );
  const connect = useMutation(orpc.sockets.connect.mutationOptions({ onSuccess: onConnected }));

  // Kept once it has come, so a later refetch that fails changes nothing here.
  if (!providers.data) {
    return providers.isError ? (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm text-destructive">
          deevy could not tell which GitHub it works with, so it cannot offer a way to connect it
          yet.
        </p>
        <Button variant="outline" className="w-fit" onClick={() => void providers.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Checking which GitHub deevy works with…</p>
    );
  }

  if (paste || pasteOnly) {
    return (
      <div className="flex flex-col gap-4">
        {pasteOnly ? (
          <p className="text-sm text-muted-foreground">
            On GitHub Enterprise Server or GHE.com, deevy cannot make the App for you: make it
            there, under Developer settings › GitHub Apps, and paste it here.
          </p>
        ) : null}
        <Field>
          <FieldLabel htmlFor="github-name">Name</FieldLabel>
          <Input
            id="github-name"
            value={name}
            placeholder="acme on GitHub"
            onChange={(changed) => setName(changed.target.value)}
          />
          <FieldDescription>What this Socket is called in deevy.</FieldDescription>
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
          {pasteOnly ? null : (
            <Button variant="ghost" onClick={() => setPaste(false)}>
              Make a new App instead
            </Button>
          )}
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
      <Field>
        <FieldLabel htmlFor="github-organization">Organization</FieldLabel>
        <Input
          id="github-organization"
          value={organization}
          placeholder="acme"
          autoComplete="off"
          spellCheck={false}
          readOnly={begun !== null}
          aria-invalid={ownerInvalid ? true : undefined}
          onChange={(changed) => setOrganization(changed.target.value)}
        />
        <FieldDescription>
          For an organization&apos;s repositories, its login on GitHub: the App is then the
          organization&apos;s, the only kind its repositories can install. Only an owner of the
          organization or one of its GitHub App managers can make it there. Leave it empty for your
          own account.
        </FieldDescription>
        {ownerInvalid ? (
          <FieldError>
            GitHub gives out no such login: letters, digits and single hyphens, with no hyphen first
            or last, and no more than 39 of them.
          </FieldError>
        ) : null}
      </Field>

      {begun ? (
        // A real form, posted by the browser: GitHub takes the manifest, makes
        // the App, and sends the operator back to deevy with a one-use code.
        <form
          aria-label="Create the App on GitHub"
          method="post"
          action={manifestAction(begun.state, begun.organization)}
          className="flex flex-col gap-2"
        >
          <input
            type="hidden"
            name="manifest"
            data-testid="manifest"
            value={JSON.stringify(begun.manifest)}
          />
          <p className="text-sm text-muted-foreground">
            {begun.organization
              ? `deevy has the name. GitHub makes the App in ${begun.organization} and sends you straight back.`
              : "deevy has the name. GitHub makes the App and sends you straight back."}
          </p>
          <Button type="submit" className="w-fit">
            Continue on GitHub
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            disabled={!name.trim() || ownerInvalid || begin.isPending}
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

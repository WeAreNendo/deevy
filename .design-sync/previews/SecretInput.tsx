import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Label,
  SecretInput,
} from "@deevy/design-system";

/** A token pasted from a tool: masked, and kept from the browser's and password managers' autofill. */
export const PastedToken = () => (
  <Field className="max-w-sm">
    <FieldLabel htmlFor="gitlab-token">Access token</FieldLabel>
    <SecretInput id="gitlab-token" defaultValue="not a real token" placeholder="glpat-…" />
    <FieldDescription>
      A personal, project or group access token with the <code>api</code> scope, for the user deevy
      comments as when a Gate waits and when it is ruled on.
    </FieldDescription>
  </Field>
);

/** Empty, with what it is and where it comes from under it. */
export const Empty = () => (
  <Field className="max-w-sm">
    <FieldLabel htmlFor="linear-secret">Webhook signing secret</FieldLabel>
    <SecretInput id="linear-secret" />
    <FieldDescription>
      Beside the webhook. Without it deevy cannot tell Linear from anybody else.
    </FieldDescription>
  </Field>
);

/** Beside the button that makes one, as an Agent's webhook has it. */
export const WithAction = () => (
  <div className="flex max-w-md flex-col gap-2">
    <Label htmlFor="signing-secret">Signing secret</Label>
    <div className="flex gap-2">
      <SecretInput id="signing-secret" placeholder="whsec_…" />
      <Button variant="outline">Generate</Button>
    </div>
    <p className="text-xs text-muted-foreground">
      At least 16 characters. deevy signs every delivery with it, and never shows it again once it
      is saved.
    </p>
  </div>
);

export const Disabled = () => (
  <Field className="max-w-sm" data-disabled>
    <FieldLabel htmlFor="notion-token">Installation access token</FieldLabel>
    <SecretInput id="notion-token" placeholder="ntn_…" disabled />
  </Field>
);

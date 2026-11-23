import { Button, Field, FieldDescription, FieldLabel, SecretInput } from "@deevy/design-system";

/** A token pasted from a tool: masked, and kept from the browser's and password managers' autofill. */
export const PastedToken = () => (
  <Field className="max-w-sm">
    <FieldLabel htmlFor="gitlab-token">Access token</FieldLabel>
    <SecretInput id="gitlab-token" defaultValue="glpat-3m9Xq2Lr8Tz1Vb7K" />
    <FieldDescription>A project access token with the api scope.</FieldDescription>
  </Field>
);

export const Empty = () => (
  <Field className="max-w-sm">
    <FieldLabel htmlFor="linear-secret">Webhook signing secret</FieldLabel>
    <SecretInput id="linear-secret" placeholder="lin_wh_…" />
  </Field>
);

/** Beside the button that mints one, as a webhook's form has it. */
export const WithAction = () => (
  <div className="flex max-w-md flex-col gap-2">
    <FieldLabel htmlFor="signing-secret">Signing secret</FieldLabel>
    <div className="flex gap-2">
      <SecretInput id="signing-secret" defaultValue="whsec_5b1f0c9e2a7d" className="flex-1" />
      <Button variant="outline">Generate</Button>
    </div>
  </div>
);

export const Disabled = () => (
  <Field className="max-w-sm" data-disabled>
    <FieldLabel htmlFor="notion-token">Installation access token</FieldLabel>
    <SecretInput id="notion-token" defaultValue="ntn_49210384756" disabled />
  </Field>
);

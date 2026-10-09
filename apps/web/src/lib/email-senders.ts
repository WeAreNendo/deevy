/**
 * What Settings › Email asks for each sender (docs/plans/email-channel.md).
 * A field marked `secret` is a credential: it is sent sealed-bound and never
 * read back, so its input starts empty and empty means "keep the saved one".
 * The rest is configuration, read back from `email.status`.
 */
export interface SenderField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  /** Said under the field. */
  hint?: string;
}

export interface SenderForm {
  label: string;
  fields: SenderField[];
}

export const senderForms: Record<string, SenderForm> = {
  resend: {
    label: "Resend",
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "re_…" }],
  },
};

/** Senders no form sets: the development stand-in (DEEVY_DEV_STUB_EMAIL). */
const otherLabels: Record<string, string> = { stub: "the development stand-in" };

/** A sender's name as a person reads it. */
export function senderLabel(kind: string | null): string {
  if (!kind) return "no sender";
  return senderForms[kind]?.label ?? otherLabels[kind] ?? kind;
}

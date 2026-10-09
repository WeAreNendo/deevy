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
  postmark: {
    label: "Postmark",
    fields: [
      { key: "serverToken", label: "Server API token", secret: true },
      {
        key: "messageStream",
        label: "Message stream",
        secret: false,
        placeholder: "outbound",
        hint: "Leave empty for the transactional stream, outbound.",
      },
    ],
  },
  sendgrid: {
    label: "SendGrid",
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "SG.…" }],
  },
  mailgun: {
    label: "Mailgun",
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      { key: "domain", label: "Sending domain", secret: false, placeholder: "mg.example.com" },
      {
        key: "region",
        label: "Region",
        secret: false,
        placeholder: "us",
        hint: "eu for a domain in Mailgun's EU region.",
      },
    ],
  },
  ses: {
    label: "Amazon SES",
    fields: [
      { key: "region", label: "AWS region", secret: false, placeholder: "eu-west-1" },
      { key: "accessKeyId", label: "Access key ID", secret: true },
      {
        key: "secretAccessKey",
        label: "Secret access key",
        secret: true,
        hint: "An IAM key that may ses:SendEmail and nothing else.",
      },
    ],
  },
};

/** Senders no form sets: the development stand-in (DEEVY_DEV_STUB_EMAIL). */
const otherLabels: Record<string, string> = { stub: "the development stand-in" };

/** A sender's name as a person reads it. */
export function senderLabel(kind: string | null): string {
  if (!kind) return "no sender";
  return senderForms[kind]?.label ?? otherLabels[kind] ?? kind;
}

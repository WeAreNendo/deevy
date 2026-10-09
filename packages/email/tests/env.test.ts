import { describe, expect, it } from "vite-plus/test";
import { emailSetupFromEnv, readEmailEnv } from "../src/env.ts";

/**
 * The sender in force, read from the environment the same way on the Node
 * server and the Worker (docs/plans/email-channel.md). A half-configured one
 * stops the instance at startup, naming what is missing, rather than starting
 * and retiring every email it owes.
 */
describe("the email sender an environment configures", () => {
  it("is none when nothing is set", () => {
    expect(emailSetupFromEnv({})).toBeNull();
  });

  it("is Resend, with its key kept apart from what is not secret", () => {
    expect(
      emailSetupFromEnv({
        DEEVY_EMAIL_SENDER: "resend",
        DEEVY_EMAIL_FROM: "deevy <deevy@example.com>",
        RESEND_API_KEY: "re_not_a_real_key",
      }),
    ).toEqual({
      sender: "resend",
      from: "deevy <deevy@example.com>",
      config: {},
      credentials: { apiKey: "re_not_a_real_key" },
    });
  });

  it("names what a half-configured sender is missing", () => {
    expect(() =>
      emailSetupFromEnv({ DEEVY_EMAIL_SENDER: "resend", DEEVY_EMAIL_FROM: "deevy@example.com" }),
    ).toThrow(/RESEND_API_KEY/);
    expect(() =>
      emailSetupFromEnv({ DEEVY_EMAIL_SENDER: "resend", RESEND_API_KEY: "re_not_a_real_key" }),
    ).toThrow(/DEEVY_EMAIL_FROM/);
    expect(() => emailSetupFromEnv({ DEEVY_EMAIL_SENDER: "pigeon" })).toThrow(/resend/);
  });

  it("is the stub in development when no sender is set, with a From of its own", () => {
    expect(emailSetupFromEnv({}, { devStub: true })).toEqual({
      sender: "stub",
      from: "deevy <deevy@example.com>",
      config: {},
      credentials: {},
    });
    // A real sender configured beside it wins: the stub stands in, never over.
    expect(
      emailSetupFromEnv(
        {
          DEEVY_EMAIL_SENDER: "resend",
          DEEVY_EMAIL_FROM: "deevy@example.com",
          RESEND_API_KEY: "re_not_a_real_key",
        },
        { devStub: true },
      )?.sender,
    ).toBe("resend");
  });

  it("hands a half-configured sender back as a problem, for a runtime that must stay up", () => {
    expect(
      readEmailEnv({ DEEVY_EMAIL_SENDER: "resend", DEEVY_EMAIL_FROM: "deevy@example.com" }),
    ).toEqual({
      setup: null,
      problem: "DEEVY_EMAIL_SENDER=resend also needs RESEND_API_KEY.",
    });
    expect(readEmailEnv({})).toEqual({ setup: null, problem: null });
  });

  it("reads every HTTP sender's own variables, secrets apart from settings", () => {
    const from = "deevy@example.com";
    expect(
      emailSetupFromEnv({
        DEEVY_EMAIL_SENDER: "postmark",
        DEEVY_EMAIL_FROM: from,
        POSTMARK_SERVER_TOKEN: "pm-token",
        POSTMARK_MESSAGE_STREAM: "deevy",
      }),
    ).toMatchObject({
      config: { messageStream: "deevy" },
      credentials: { serverToken: "pm-token" },
    });
    expect(
      emailSetupFromEnv({
        DEEVY_EMAIL_SENDER: "sendgrid",
        DEEVY_EMAIL_FROM: from,
        SENDGRID_API_KEY: "SG.k",
      }),
    ).toMatchObject({ credentials: { apiKey: "SG.k" } });
    expect(
      emailSetupFromEnv({
        DEEVY_EMAIL_SENDER: "mailgun",
        DEEVY_EMAIL_FROM: from,
        MAILGUN_API_KEY: "key",
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_REGION: "eu",
      }),
    ).toMatchObject({
      config: { domain: "mg.example.com", region: "eu" },
      credentials: { apiKey: "key" },
    });
    expect(
      emailSetupFromEnv({
        DEEVY_EMAIL_SENDER: "ses",
        DEEVY_EMAIL_FROM: from,
        AWS_SES_REGION: "eu-west-1",
        AWS_SES_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SES_SECRET_ACCESS_KEY: "secret",
      }),
    ).toMatchObject({
      config: { region: "eu-west-1" },
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
    });
    expect(() =>
      emailSetupFromEnv({
        DEEVY_EMAIL_SENDER: "mailgun",
        DEEVY_EMAIL_FROM: from,
        MAILGUN_API_KEY: "key",
      }),
    ).toThrow(/MAILGUN_DOMAIN/);
  });
});

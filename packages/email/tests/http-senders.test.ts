import type { EmailMessage, EmailSender } from "@deevy/core/email";
import { describe, expect, it } from "vite-plus/test";
import { createMailgunSender } from "../src/mailgun/index.ts";
import { createPostmarkSender } from "../src/postmark/index.ts";
import { createSendgridSender } from "../src/sendgrid/index.ts";

/**
 * Postmark, SendGrid and Mailgun, each against the request and the answers
 * its API reference documents, with an injected fetch: never the network.
 *
 * - Postmark: postmarkapp.com/developer/api/email-api
 * - SendGrid: www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 * - Mailgun: documentation.mailgun.com, Messages › Send an email
 */
const message: EmailMessage = {
  from: { address: "deevy@example.com", name: "deevy" },
  to: "ada@example.com",
  replyTo: "no-reply@example.com",
  subject: "Gate waiting: acme/deevy#42 · plan",
  text: "Planner asks to pass plan.",
  html: "<p>Planner asks to pass plan.</p>",
  headers: {
    "List-Unsubscribe": "<https://deevy.example.com/api/email/unsubscribe/t>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
  idempotencyKey: "dlv_0123456789ab",
};

type Call = { url: string; init: RequestInit };

function answering(answer: Response | Error) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    if (answer instanceof Error) throw answer;
    return answer.clone();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

/** Every sender treats a slow-down, an outage and a dropped connection as worth another try. */
async function retriesTheTransient(build: (fetch: typeof globalThis.fetch) => EmailSender) {
  for (const answer of [
    new Response("slow down", { status: 429 }),
    new Response("upstream", { status: 503 }),
    new TypeError("fetch failed"),
  ]) {
    const { fetch } = answering(answer);
    expect(await build(fetch).send(message)).toMatchObject({ delivered: false, retry: true });
  }
}

describe("Postmark", () => {
  const build = (fetch: typeof globalThis.fetch, config: Record<string, string> = {}) =>
    createPostmarkSender({ config, credentials: { serverToken: "pm-not-a-real-token" }, fetch });

  it("posts the email with the server token, on the transactional stream", async () => {
    const { calls, fetch } = answering(
      Response.json({
        To: "ada@example.com",
        SubmittedAt: "2026-10-09T08:00:00Z",
        MessageID: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817",
        ErrorCode: 0,
        Message: "OK",
      }),
    );

    expect(await build(fetch).send(message)).toEqual({
      delivered: true,
      status: 200,
      id: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://api.postmarkapp.com/email");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("x-postmark-server-token")).toBe("pm-not-a-real-token");
    expect(headers.get("accept")).toBe("application/json");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      From: '"deevy" <deevy@example.com>',
      To: "ada@example.com",
      ReplyTo: "no-reply@example.com",
      Subject: "Gate waiting: acme/deevy#42 · plan",
      TextBody: "Planner asks to pass plan.",
      HtmlBody: "<p>Planner asks to pass plan.</p>",
      Headers: [
        { Name: "List-Unsubscribe", Value: "<https://deevy.example.com/api/email/unsubscribe/t>" },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
      ],
      MessageStream: "outbound",
    });
  });

  it("sends on the stream it was told", async () => {
    const { calls, fetch } = answering(Response.json({ ErrorCode: 0, MessageID: "x" }));
    await build(fetch, { messageStream: "deevy-notifications" }).send(message);
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      MessageStream: "deevy-notifications",
    });
  });

  it("retires what Postmark refuses for good, in its words", async () => {
    // 406: the recipient bounced or complained before, so Postmark will not send.
    const { fetch } = answering(
      Response.json(
        {
          ErrorCode: 406,
          Message: "You tried to send to recipient(s) that have been marked as inactive.",
        },
        { status: 422 },
      ),
    );
    expect(await build(fetch).send(message)).toEqual({
      delivered: false,
      retry: false,
      status: 422,
      error: "You tried to send to recipient(s) that have been marked as inactive.",
    });
  });

  it("tries again on what passes", () => retriesTheTransient((fetch) => build(fetch)));

  it("refuses to be built without a server token", () => {
    expect(() =>
      createPostmarkSender({ config: {}, credentials: {}, fetch: globalThis.fetch }),
    ).toThrow("Postmark needs a server token.");
  });
});

describe("SendGrid", () => {
  const build = (fetch: typeof globalThis.fetch) =>
    createSendgridSender({ config: {}, credentials: { apiKey: "SG.not-a-real-key" }, fetch });

  it("posts v3 mail/send with text before HTML, and reads the id from the header", async () => {
    const { calls, fetch } = answering(
      new Response(null, { status: 202, headers: { "x-message-id": "14c5d75ce93.dfd.64b469" } }),
    );

    expect(await build(fetch).send(message)).toEqual({
      delivered: true,
      status: 202,
      id: "14c5d75ce93.dfd.64b469",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(new Headers(call?.init.headers).get("authorization")).toBe("Bearer SG.not-a-real-key");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      personalizations: [{ to: [{ email: "ada@example.com" }] }],
      from: { email: "deevy@example.com", name: "deevy" },
      reply_to: { email: "no-reply@example.com" },
      subject: "Gate waiting: acme/deevy#42 · plan",
      // SendGrid wants text/plain first when both are given.
      content: [
        { type: "text/plain", value: "Planner asks to pass plan." },
        { type: "text/html", value: "<p>Planner asks to pass plan.</p>" },
      ],
      headers: {
        "List-Unsubscribe": "<https://deevy.example.com/api/email/unsubscribe/t>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });

  it("retires what SendGrid refuses for good, in its words", async () => {
    const { fetch } = answering(
      Response.json(
        {
          errors: [
            {
              message:
                "The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved.",
              field: "from",
              help: "https://sendgrid.com/docs/for-developers/sending-email/sender-identity/",
            },
          ],
        },
        { status: 403 },
      ),
    );
    expect(await build(fetch).send(message)).toMatchObject({
      delivered: false,
      retry: false,
      status: 403,
      error:
        "The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved.",
    });
  });

  it("tries again on what passes", () => retriesTheTransient(build));

  it("refuses to be built without a key", () => {
    expect(() =>
      createSendgridSender({ config: {}, credentials: {}, fetch: globalThis.fetch }),
    ).toThrow("SendGrid needs an API key.");
  });
});

describe("Mailgun", () => {
  const build = (fetch: typeof globalThis.fetch, config: Record<string, string> = {}) =>
    createMailgunSender({
      config: { domain: "mg.example.com", ...config },
      credentials: { apiKey: "key-not-a-real-key" },
      fetch,
    });

  it("posts the message as a form to the domain, with the headers as h: fields", async () => {
    const { calls, fetch } = answering(
      Response.json({
        id: "<20261009080000.1.ABCDEF@mg.example.com>",
        message: "Queued. Thank you.",
      }),
    );

    expect(await build(fetch).send(message)).toEqual({
      delivered: true,
      status: 200,
      id: "<20261009080000.1.ABCDEF@mg.example.com>",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect(new Headers(call?.init.headers).get("authorization")).toBe(
      `Basic ${btoa("api:key-not-a-real-key")}`,
    );
    const form = new URLSearchParams(call?.init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      from: '"deevy" <deevy@example.com>',
      to: "ada@example.com",
      subject: "Gate waiting: acme/deevy#42 · plan",
      text: "Planner asks to pass plan.",
      html: "<p>Planner asks to pass plan.</p>",
      "h:Reply-To": "no-reply@example.com",
      "h:List-Unsubscribe": "<https://deevy.example.com/api/email/unsubscribe/t>",
      "h:List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("sends from the EU region when told", async () => {
    const { calls, fetch } = answering(Response.json({ id: "<x>", message: "Queued." }));
    await build(fetch, { region: "eu" }).send(message);
    expect(calls[0]?.url).toBe("https://api.eu.mailgun.net/v3/mg.example.com/messages");
  });

  it("retires what Mailgun refuses for good, in its words", async () => {
    const { fetch } = answering(
      Response.json(
        {
          message:
            "Domain mg.example.com is not allowed to send: Free accounts are for test purposes only.",
        },
        { status: 403 },
      ),
    );
    expect(await build(fetch).send(message)).toMatchObject({
      delivered: false,
      retry: false,
      status: 403,
      error:
        "Domain mg.example.com is not allowed to send: Free accounts are for test purposes only.",
    });
  });

  it("tries again on what passes", () => retriesTheTransient((fetch) => build(fetch)));

  it("refuses to be built without a key or a domain", () => {
    expect(() =>
      createMailgunSender({
        config: { domain: "mg.example.com" },
        credentials: {},
        fetch: globalThis.fetch,
      }),
    ).toThrow("Mailgun needs an API key.");
    expect(() =>
      createMailgunSender({
        config: {},
        credentials: { apiKey: "key" },
        fetch: globalThis.fetch,
      }),
    ).toThrow("Mailgun needs its sending domain.");
  });
});

describe("every HTTP sender", () => {
  it("gives up on a request that never answers, as a retry, rather than holding the sweep", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const senders = [
      createPostmarkSender({
        config: {},
        credentials: { serverToken: "t" },
        fetch: hanging,
        timeoutMs: 20,
      }),
      createSendgridSender({
        config: {},
        credentials: { apiKey: "k" },
        fetch: hanging,
        timeoutMs: 20,
      }),
      createMailgunSender({
        config: { domain: "mg.example.com" },
        credentials: { apiKey: "k" },
        fetch: hanging,
        timeoutMs: 20,
      }),
    ];
    for (const sender of senders) {
      expect(await sender.send(message)).toMatchObject({ delivered: false, retry: true });
    }
  });
});

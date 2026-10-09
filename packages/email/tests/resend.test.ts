import type { EmailMessage } from "@deevy/core/email";
import { describe, expect, it } from "vite-plus/test";
import { createResendSender } from "../src/resend/index.ts";

/**
 * Resend, against the request and the answers its API reference documents
 * (resend.com/docs/api-reference/emails/send-email), with an injected fetch:
 * never the network.
 */
const message: EmailMessage = {
  from: { address: "deevy@example.com", name: "deevy" },
  to: "ada@example.com",
  replyTo: "no-reply@example.com",
  subject: "Gate waiting: acme/deevy#42 · plan",
  text: "Planner asks to pass plan.",
  html: "<p>Planner asks to pass plan.</p>",
  headers: { "List-Unsubscribe": "<https://deevy.example.com/email/unsubscribe/t>" },
  idempotencyKey: "dlv_0123456789ab",
};

function resend(answer: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sender = createResendSender({
    config: {},
    credentials: { apiKey: "re_not_a_real_key" },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        init: init ?? {},
      });
      if (answer instanceof Error) throw answer;
      return answer.clone();
    }) as typeof fetch,
  });
  return { sender, calls };
}

describe("Resend", () => {
  it("posts the email as its API takes one, keyed so a retry is not a second email", async () => {
    const { sender, calls } = resend(Response.json({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }));

    const sent = await sender.send(message);

    expect(sent).toEqual({
      delivered: true,
      status: 200,
      id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_not_a_real_key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe("dlv_0123456789ab");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      from: '"deevy" <deevy@example.com>',
      to: ["ada@example.com"],
      reply_to: "no-reply@example.com",
      subject: "Gate waiting: acme/deevy#42 · plan",
      text: "Planner asks to pass plan.",
      html: "<p>Planner asks to pass plan.</p>",
      headers: { "List-Unsubscribe": "<https://deevy.example.com/email/unsubscribe/t>" },
    });
  });

  it("retires what waiting cannot fix, in Resend's own words", async () => {
    // A From on a domain Resend has not verified: 403, `validation_error`.
    const { sender } = resend(
      Response.json(
        {
          statusCode: 403,
          name: "validation_error",
          message: "The example.com domain is not verified. Please, add and verify your domain.",
        },
        { status: 403 },
      ),
    );

    expect(await sender.send(message)).toEqual({
      delivered: false,
      retry: false,
      status: 403,
      error: "The example.com domain is not verified. Please, add and verify your domain.",
    });
  });

  it("tries again later when Resend asks for time, or is down, or cannot be reached", async () => {
    for (const answer of [
      Response.json(
        { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests." },
        { status: 429 },
      ),
      new Response("upstream error", { status: 502 }),
      new TypeError("fetch failed"),
    ]) {
      const { sender } = resend(answer);
      expect(await sender.send(message)).toMatchObject({ delivered: false, retry: true });
    }
  });

  it("tries again when Resend is still handling the same key, as its docs say to", async () => {
    const { sender } = resend(
      Response.json(
        {
          statusCode: 409,
          name: "concurrent_idempotent_requests",
          message: "Same idempotency key used while original request is still in progress",
        },
        { status: 409 },
      ),
    );
    expect(await sender.send(message)).toMatchObject({
      delivered: false,
      retry: true,
      status: 409,
    });
  });

  it("gives up on a request that never answers, rather than holding the sweep", async () => {
    const sender = createResendSender({
      config: {},
      credentials: { apiKey: "re_not_a_real_key" },
      timeoutMs: 20,
      fetch: ((_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof fetch,
    });
    expect(await sender.send(message)).toMatchObject({ delivered: false, retry: true, status: 0 });
  });

  it("refuses to be built without a key, rather than failing every send", () => {
    expect(() =>
      createResendSender({ config: {}, credentials: {}, fetch: globalThis.fetch }),
    ).toThrow("Resend needs an API key.");
  });
});

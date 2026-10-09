import type { EmailMessage } from "@deevy/core/email";
import { describe, expect, it } from "vite-plus/test";
import { createSesSender } from "../src/ses/index.ts";
import { signV4 } from "../src/ses/sigv4.ts";

/**
 * Amazon SES v2 (docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html),
 * signed with Signature Version 4 over `crypto.subtle` so it runs on Workers.
 */
describe("Signature Version 4", () => {
  it("signs AWS's own get-vanilla case to the signature its test suite publishes", async () => {
    // aws-sig-v4-test-suite/get-vanilla: GET / on example.amazonaws.com at
    // 20150830T123600Z, with the suite's example credentials.
    const signed = await signV4({
      method: "GET",
      url: "https://example.amazonaws.com/",
      headers: {},
      body: "",
      region: "us-east-1",
      service: "service",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      now: new Date("2015-08-30T12:36:00Z"),
      signPayloadHeader: false,
    });

    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
    expect(signed.headers["x-amz-date"]).toBe("20150830T123600Z");
  });
});

const message: EmailMessage = {
  from: { address: "deevy@example.com", name: "deevy" },
  to: "ada@example.com",
  subject: "Gate waiting: acme/deevy#42 · plan",
  text: "Planner asks to pass plan.",
  html: "<p>Planner asks to pass plan.</p>",
  headers: { "List-Unsubscribe": "<https://deevy.example.com/api/email/unsubscribe/t>" },
};

function ses(answer: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sender = createSesSender({
    config: { region: "eu-west-1" },
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "not-a-real-secret" },
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

describe("Amazon SES", () => {
  it("posts a simple message to the region's v2 endpoint, signed for ses", async () => {
    const { sender, calls } = ses(Response.json({ MessageId: "0102018f-example" }));

    expect(await sender.send(message)).toEqual({
      delivered: true,
      status: 200,
      id: "0102018f-example",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.parse(call?.init.body as string)).toEqual({
      FromEmailAddress: '"deevy" <deevy@example.com>',
      Destination: { ToAddresses: ["ada@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "Gate waiting: acme/deevy#42 · plan", Charset: "UTF-8" },
          Body: {
            Text: { Data: "Planner asks to pass plan.", Charset: "UTF-8" },
            Html: { Data: "<p>Planner asks to pass plan.</p>", Charset: "UTF-8" },
          },
          Headers: [
            {
              Name: "List-Unsubscribe",
              Value: "<https://deevy.example.com/api/email/unsubscribe/t>",
            },
          ],
        },
      },
    });
  });

  it("retires what SES refuses for good, naming its error", async () => {
    const { sender } = ses(
      Response.json(
        {
          message:
            "Email address is not verified. The following identities failed the check in region EU-WEST-1: deevy@example.com",
        },
        {
          status: 400,
          headers: {
            "x-amzn-errortype":
              "MessageRejected:http://internal.amazon.com/coral/com.amazonaws.sesv2/",
          },
        },
      ),
    );
    expect(await sender.send(message)).toEqual({
      delivered: false,
      retry: false,
      status: 400,
      error:
        "MessageRejected: Email address is not verified. The following identities failed the check in region EU-WEST-1: deevy@example.com",
    });
  });

  it("tries again when SES throttles or is down", async () => {
    for (const answer of [
      Response.json({ message: "Too many requests" }, { status: 429 }),
      new Response("", { status: 503 }),
      new TypeError("fetch failed"),
    ]) {
      expect(await ses(answer).sender.send(message)).toMatchObject({
        delivered: false,
        retry: true,
      });
    }
  });

  it("refuses to be built without a region or a key pair", () => {
    expect(() =>
      createSesSender({
        config: {},
        credentials: { accessKeyId: "a", secretAccessKey: "b" },
        fetch: globalThis.fetch,
      }),
    ).toThrow(/AWS_SES_REGION/);
    expect(() =>
      createSesSender({
        config: { region: "eu-west-1" },
        credentials: {},
        fetch: globalThis.fetch,
      }),
    ).toThrow(/AWS_SES_ACCESS_KEY_ID/);
  });
});

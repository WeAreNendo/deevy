import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createSmtpSender } from "../src/node/smtp.ts";
import { createCloudflareSender } from "../src/workers/email.ts";

/**
 * The two senders only one runtime can run (docs/plans/email-channel.md,
 * slice 5): SMTP on the Node server, tested against a real SMTP server in
 * this process; and Cloudflare Email Service on the Worker, tested against a
 * stand-in for its `send_email` binding that answers as its docs say.
 */
const message = {
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
};

const servers: SMTPServer[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((one) => new Promise<void>((done) => one.close(() => done()))),
  );
});

/** An SMTP server on a free port that keeps what it was sent, or refuses as told. */
async function smtpServer(options: { refuse?: { code: number; text: string } } = {}) {
  const received: Array<{ from: string; to: string[]; data: string; user?: string }> = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      if (auth.username === "deevy" && auth.password === "not-a-real-password") {
        callback(null, { user: auth.username });
      } else callback(new Error("Invalid username or password"));
    },
    onRcptTo(_address, _session, callback) {
      if (options.refuse) {
        const error = new Error(options.refuse.text) as Error & { responseCode: number };
        error.responseCode = options.refuse.code;
        callback(error);
      } else callback();
    },
    onData(stream, session, callback) {
      let data = "";
      stream.on("data", (chunk: Buffer) => (data += chunk.toString()));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((one) => one.address),
          data,
          ...(typeof session.user === "string" ? { user: session.user } : {}),
        });
        callback();
      });
    },
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()));
  const { port } = server.server.address() as { port: number };
  return { port, received };
}

describe("SMTP", () => {
  it("delivers the email to the server it names, signed in, with both bodies and the headers", async () => {
    const { port, received } = await smtpServer();
    const sender = createSmtpSender({
      config: {},
      credentials: { url: `smtp://deevy:not-a-real-password@127.0.0.1:${String(port)}` },
    });

    const sent = await sender.send(message);

    expect(sent).toMatchObject({ delivered: true, status: 250 });
    expect(received).toHaveLength(1);
    const [got] = received;
    expect(got?.user).toBe("deevy");
    expect(got?.from).toBe("deevy@example.com");
    expect(got?.to).toEqual(["ada@example.com"]);
    // The subject carries a "·", so it travels MIME-encoded, as it must.
    expect(got?.data).toMatch(/^Subject: =\?UTF-8\?Q\?Gate_waiting/m);
    expect(got?.data).toContain(
      "List-Unsubscribe: <https://deevy.example.com/api/email/unsubscribe/t>",
    );
    expect(got?.data).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(got?.data).toContain("Reply-To: no-reply@example.com");
    expect(got?.data).toContain("Planner asks to pass plan.");
    expect(got?.data).toContain("text/html");
  });

  it("retires a 5xx refusal and retries a 4xx one, in the server's words", async () => {
    const permanent = await smtpServer({ refuse: { code: 550, text: "No such user here" } });
    const temporary = await smtpServer({ refuse: { code: 451, text: "Try again later" } });
    const send = (port: number) =>
      createSmtpSender({
        config: {},
        credentials: { url: `smtp://127.0.0.1:${String(port)}` },
      }).send(message);

    expect(await send(permanent.port)).toMatchObject({
      delivered: false,
      retry: false,
      status: 550,
      error: expect.stringContaining("No such user here") as unknown as string,
    });
    expect(await send(temporary.port)).toMatchObject({
      delivered: false,
      retry: true,
      status: 451,
    });
  });

  it("retries a server that cannot be reached", async () => {
    const sender = createSmtpSender({ config: {}, credentials: { url: "smtp://127.0.0.1:1" } });
    expect(await sender.send(message)).toMatchObject({ delivered: false, retry: true });
  });

  it("refuses to be built without a URL, or with one that is not SMTP", () => {
    expect(() => createSmtpSender({ config: {}, credentials: {} })).toThrow(/SMTP_URL/);
    expect(() =>
      createSmtpSender({ config: {}, credentials: { url: "https://example.com" } }),
    ).toThrow(/smtp:\/\/ or smtps:\/\//);
  });
});

/** A `send_email` binding that answers as Cloudflare documents, or throws its error. */
function binding(failure?: { code: string; message: string }) {
  const sent: unknown[] = [];
  return {
    sent,
    EMAIL: {
      send: (input: unknown) => {
        sent.push(input);
        if (failure) {
          const error = new Error(failure.message) as Error & { code: string };
          error.code = failure.code;
          return Promise.reject(error);
        }
        return Promise.resolve({ messageId: "cf-0001" });
      },
    },
  };
}

describe("Cloudflare Email Service", () => {
  it("sends through the binding with the builder's fields", async () => {
    const { EMAIL, sent } = binding();

    expect(await createCloudflareSender(EMAIL).send(message)).toEqual({
      delivered: true,
      status: 200,
      id: "cf-0001",
    });
    expect(sent).toEqual([
      {
        to: "ada@example.com",
        from: { email: "deevy@example.com", name: "deevy" },
        replyTo: "no-reply@example.com",
        subject: "Gate waiting: acme/deevy#42 · plan",
        text: "Planner asks to pass plan.",
        html: "<p>Planner asks to pass plan.</p>",
        headers: message.headers,
      },
    ]);
  });

  it("leaves off an unsubscribe Cloudflare would refuse for not being https", async () => {
    const { EMAIL, sent } = binding();
    await createCloudflareSender(EMAIL).send({
      ...message,
      headers: {
        "List-Unsubscribe": "<http://localhost:8787/api/email/unsubscribe/t>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    expect((sent[0] as { headers?: unknown }).headers).toBeUndefined();
  });

  it("retires a refusal Cloudflare says needs fixing, and retries a rate limit", async () => {
    const refused = binding({
      code: "E_SENDER_NOT_VERIFIED",
      message: "Sender domain example.com is not verified",
    });
    expect(await createCloudflareSender(refused.EMAIL).send(message)).toEqual({
      delivered: false,
      retry: false,
      status: 0,
      error: "E_SENDER_NOT_VERIFIED: Sender domain example.com is not verified",
    });
    for (const code of ["E_RATE_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR", "E_DELIVERY_FAILED"]) {
      const busy = binding({ code, message: "later" });
      expect(await createCloudflareSender(busy.EMAIL).send(message)).toMatchObject({
        delivered: false,
        retry: true,
      });
    }
  });
});

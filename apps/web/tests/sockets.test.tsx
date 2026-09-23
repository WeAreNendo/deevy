import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * Connecting a tool, and reading how it is doing (docs/plans/sockets.md).
 *
 * A Socket is the most administering thing in deevy — it is where a credential
 * enters — so this screen has two jobs and no others: make connecting one
 * possible without a terminal, and say plainly whether the tool is talking to
 * deevy or deevy is having to ask.
 */
const calls = vi.hoisted(() => ({
  begin: vi.fn(async (_input: { provider: string; name: string }) => ({})),
  connect: vi.fn(async (_input: Record<string, unknown>) => ({})),
  rotate: vi.fn(async (_input: { socketId: string }) => ({})),
  update: vi.fn(async (_input: Record<string, unknown>) => ({})),
  remove: vi.fn(async (_input: { socketId: string }) => ({})),
}));

const state = vi.hoisted(() => ({ sockets: [] as unknown[], lastInboundAt: null as Date | null }));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubSocket } = await import("./stub-client.ts");
  const client = stubClient({
    sockets: {
      providers: async () => ({
        providers: [
          { id: "github", label: "GitHub", capabilities: ["tracker", "forge"] },
          { id: "slack", label: "Slack", capabilities: ["chat"] },
          { id: "stub", label: "the stub tracker", capabilities: ["tracker"] },
        ],
      }),
      list: async () => ({ sockets: state.sockets }),
      begin: async (input: { provider: string; name: string }) => {
        void calls.begin(input);
        return {
          ...stubSocket,
          id: "sock_pending0000",
          provider: input.provider,
          name: input.name,
          status: "pending",
          hasCredentials: false,
          hasWebhookSecret: false,
          inboundUrl: "https://deevy.test/hooks/sock_pending0000",
          setupUrl: "https://deevy.test/hooks/sock_pending0000/setup",
          webhookSecret: null,
          state: "1790000000000.abc",
        };
      },
      connect: async (input: Record<string, unknown>) => {
        void calls.connect(input);
        return {
          ...stubSocket,
          hasCredentials: true,
          hasWebhookSecret: true,
          inboundUrl: "https://deevy.test/hooks/sock_stub00000",
          webhookSecret: null,
        };
      },
      rotate: async (input: { socketId: string }) => {
        void calls.rotate(input);
        return {
          socket: { ...stubSocket, hasWebhookSecret: true },
          webhookSecret: "whsec_said_exactly_once",
          inboundUrl: "https://deevy.test/hooks/sock_stub00000",
        };
      },
      update: async (input: Record<string, unknown>) => {
        void calls.update(input);
        return { ...stubSocket, status: input.status ?? "active" };
      },
      remove: async (input: { socketId: string }) => {
        void calls.remove(input);
        return { ...stubSocket, status: "removed" };
      },
      test: async () => ({ ok: true, identity: stubSocket.identity }),
      containers: async () => ({
        containers: [
          { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
        ],
      }),
      inbound: async () => ({
        deliveries: [
          {
            id: "inb_1",
            socketId: "sock_stub00000",
            deliveryId: "0b989ba4",
            eventName: "issues",
            status: "applied",
            error: null,
            createdAt: new Date("2026-09-21T09:00:00Z"),
          },
        ],
      }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");
const { stubSocket } = await import("./stub-client.ts");

describe("the tools this Workspace is connected to", () => {
  it("lists them, and offers only the ones this deevy can speak", async () => {
    state.sockets = [
      { ...stubSocket, name: "acme on GitHub", provider: "github", hasCredentials: true },
    ];

    await mountAt("/settings/sockets");

    expect(await screen.findByRole("heading", { name: "Sockets" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Sockets" });
    expect(within(list).getByText("acme on GitHub")).toBeTruthy();

    // What the build can speak, from the server: a button for a provider it
    // was not built with would only ever produce a refusal.
    const connect = screen.getByRole("group", { name: "Connect a tool" });
    expect(within(connect).getByRole("button", { name: /GitHub/ })).toBeTruthy();
    expect(within(connect).queryByRole("button", { name: /Linear/ })).toBeNull();
  });

  it("starts the GitHub flow with a form GitHub itself takes", async () => {
    state.sockets = [];
    calls.begin.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme on GitHub" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the App on GitHub" }));

    await waitFor(() => expect(calls.begin).toHaveBeenCalledTimes(1));
    expect(calls.begin.mock.calls[0]?.[0]).toMatchObject({
      provider: "github",
      name: "acme on GitHub",
    });

    // The form posts to GitHub, carrying the manifest and the state deevy
    // signed. Everything GitHub needs to make the App is in that JSON.
    const form = await screen.findByRole("form", { name: "Create the App on GitHub" });
    expect(form.getAttribute("action")).toBe(
      "https://github.com/settings/apps/new?state=1790000000000.abc",
    );
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    const manifest = JSON.parse(
      (within(form).getByTestId("manifest") as HTMLInputElement).value,
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "acme on GitHub",
      redirect_url: "https://deevy.test/hooks/sock_pending0000/setup",
      setup_url: "https://deevy.test/hooks/sock_pending0000/setup",
      hook_attributes: { url: "https://deevy.test/hooks/sock_pending0000", active: true },
      public: false,
      default_permissions: {
        issues: "write",
        metadata: "read",
        contents: "write",
        pull_requests: "write",
      },
    });
    expect(manifest.default_events).toEqual([
      "issues",
      "issue_comment",
      "sub_issues",
      "label",
      "repository",
    ]);
  });

  it("takes an App somebody already made, pasted", async () => {
    state.sockets = [];
    calls.connect.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
    fireEvent.click(screen.getByRole("button", { name: "Paste an App you already have" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme on GitHub" } });
    fireEvent.change(screen.getByLabelText("App id"), { target: { value: "1284461" } });
    fireEvent.change(screen.getByLabelText("Private key"), {
      target: { value: "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----" },
    });
    fireEvent.change(screen.getByLabelText("Webhook secret"), {
      target: { value: "whsec_pasted_from_github" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toMatchObject({
      provider: "github",
      name: "acme on GitHub",
      config: { appId: "1284461" },
      credentials: { privateKey: expect.stringContaining("BEGIN RSA PRIVATE KEY") as unknown },
      webhookSecret: "whsec_pasted_from_github",
    });
  });

  it("connects Slack in one trip: the manifest with the real address, then the token", async () => {
    state.sockets = [];
    calls.begin.mockClear();
    calls.connect.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: "Connect Slack" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Slack" } });
    fireEvent.click(screen.getByRole("button", { name: "Show the app manifest" }));

    // The committed manifest (docs/slack-manifest.yaml), with this Socket's own
    // address where Slack will send clicks and the slash command.
    const manifest = await screen.findByLabelText("App manifest");
    const text = manifest.textContent ?? "";
    expect(text.match(/https:\/\/deevy\.test\/hooks\/sock_pending0000/g)).toHaveLength(2);
    expect(text).not.toContain("SOCKET_ID");
    expect(text).toContain("chat:write");
    expect(text).toContain("command: /deevy");

    fireEvent.change(screen.getByLabelText("Bot User OAuth Token"), {
      target: { value: "xoxb-pasted-from-slack" },
    });
    fireEvent.change(screen.getByLabelText("Signing Secret"), {
      target: { value: "8f14e45fceea167a5a36dedd4bea2543" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toEqual({
      provider: "slack",
      name: "Acme Slack",
      socketId: "sock_pending0000",
      credentials: { botToken: "xoxb-pasted-from-slack" },
      webhookSecret: "8f14e45fceea167a5a36dedd4bea2543",
    });
  });
});

describe("one Socket's own page", () => {
  it("says when the tool last spoke, and what it said", async () => {
    state.sockets = [
      {
        ...stubSocket,
        name: "acme on GitHub",
        provider: "github",
        hasCredentials: true,
        lastInboundAt: new Date(Date.now() - 2 * 60_000),
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);

    expect(await screen.findByRole("heading", { name: "acme on GitHub" })).toBeTruthy();
    expect(screen.getByText(/Spoke 2 minutes ago/)).toBeTruthy();
    const deliveries = screen.getByRole("table", { name: "Deliveries" });
    expect(within(deliveries).getByText("issues")).toBeTruthy();
  });

  it("says deevy is asking when the tool has gone quiet", async () => {
    state.sockets = [
      {
        ...stubSocket,
        name: "acme on GitHub",
        provider: "github",
        hasCredentials: true,
        lastInboundAt: new Date(Date.now() - 26 * 60 * 60_000),
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);

    // Silence is not an error — polling is the fallback that keeps an instance
    // no tool can reach working — but a Human should know which one is
    // happening (docs/plans/sockets.md, slice 1).
    expect(await screen.findByText(/deevy is asking it/)).toBeTruthy();
  });

  it("mints a webhook secret and shows it exactly once", async () => {
    state.sockets = [{ ...stubSocket, name: "acme on GitHub", hasCredentials: true }];
    calls.rotate.mockClear();

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Mint a webhook secret" }));

    await waitFor(() => expect(calls.rotate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("whsec_said_exactly_once")).toBeTruthy();
    expect(screen.getByText(/only time/i)).toBeTruthy();
  });

  it("rests it, and disconnects it with the credential", async () => {
    state.sockets = [{ ...stubSocket, name: "acme on GitHub", hasCredentials: true }];
    calls.update.mockClear();
    calls.remove.mockClear();

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    expect(calls.update.mock.calls[0]?.[0]).toMatchObject({ status: "paused" });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect it" }));
    await waitFor(() => expect(calls.remove).toHaveBeenCalledTimes(1));
  });
});

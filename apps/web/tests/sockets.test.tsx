import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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
  install: vi.fn(async (_input: { socketId: string }) => ({})),
  rewire: vi.fn(async (_input: { socketId: string }) => ({})),
  left: [] as string[],
}));

// Leaving deevy for the tool's own page is a navigation jsdom cannot do, so the
// one helper that does it is replaced by a list of where it would have gone.
vi.mock("../src/lib/leave.ts", () => ({
  leaveFor: (url: string) => {
    calls.left.push(url);
  },
}));

const state = vi.hoisted(() => ({
  sockets: [] as unknown[],
  lastInboundAt: null as Date | null,
  /** Holds the providers' answer back, as a slow first load does. */
  providersPending: false,
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubSocket } = await import("./stub-client.ts");
  const client = stubClient({
    sockets: {
      providers: async () =>
        state.providersPending
          ? new Promise<never>(() => undefined)
          : {
              providers: [
                { id: "github", label: "GitHub", capabilities: ["tracker", "forge"] },
                { id: "gitlab", label: "GitLab", capabilities: ["tracker", "forge"] },
                { id: "linear", label: "Linear", capabilities: ["tracker"] },
                { id: "notion", label: "Notion", capabilities: ["tracker", "docs"] },
                { id: "slack", label: "Slack", capabilities: ["chat"] },
                { id: "stub", label: "the stub tracker", capabilities: ["tracker"] },
              ],
            },
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
          accountCallbackUrl: `https://deevy.test/api/identities/${input.provider}/callback`,
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
      rewire: async (input: { socketId: string }) => {
        void calls.rewire(input);
        return { inboundUrl: "https://deevy.test/hooks/sock_stub00000" };
      },
      handshake: async () => ({
        token: "secret_notion-verification-token-for-tests",
        verified: false,
      }),
      install: async (input: { socketId: string }) => {
        void calls.install(input);
        return { url: "https://linear.app/oauth/authorize?actor=app" };
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

/**
 * A field that holds a secret: masked, and kept from the browser's and the
 * password manager's autofill. Every connect dialog showed them in the clear
 * until the Linear check typed one (2026-09-25).
 */
function secret(label: string): HTMLElement {
  const field = screen.getByLabelText(label);
  expect(field.getAttribute("type")).toBe("password");
  expect(field.getAttribute("autocomplete")).toBe("off");
  expect(field.hasAttribute("data-1p-ignore")).toBe(true);
  return field;
}
const { stubSocket } = await import("./stub-client.ts");

afterEach(() => {
  state.providersPending = false;
});

describe("the tools this Workspace is connected to", () => {
  it("says nothing about which tools there are until the server has said", async () => {
    state.sockets = [];
    state.providersPending = true;

    await mountAt("/settings/sockets");
    const connect = await screen.findByRole("region", { name: "Connect a tool" });

    // The Linear check read "built with no tools it can connect" on a deevy
    // built with five, for as long as the list took to arrive.
    expect(within(connect).queryByText(/built with no tools/)).toBeNull();
  });

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
    expect(within(connect).queryByRole("button", { name: /Jira/ })).toBeNull();
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
    fireEvent.change(secret("Webhook secret"), {
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

    fireEvent.change(secret("Bot User OAuth Token"), {
      target: { value: "xoxb-pasted-from-slack" },
    });
    fireEvent.change(secret("Signing Secret"), {
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

describe("connecting GitLab", () => {
  it("takes the instance and a token, then says where GitLab sends deliveries and with what", async () => {
    state.sockets = [];
    calls.connect.mockClear();
    calls.rotate.mockClear();
    calls.update.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: "Connect GitLab" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme on GitLab" } });
    fireEvent.change(screen.getByLabelText("GitLab URL"), {
      target: { value: "https://gitlab.example.com/" },
    });
    fireEvent.change(secret("Access token"), {
      target: { value: "glpat-pasted-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toEqual({
      provider: "gitlab",
      name: "Acme on GitLab",
      config: { baseUrl: "https://gitlab.example.com" },
      credentials: { token: "glpat-pasted-token" },
    });

    // Connected: a secret token deevy minted, shown once, for GitLab's webhook.
    await waitFor(() => expect(calls.rotate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("whsec_said_exactly_once")).toBeTruthy();
    expect(screen.getByText("https://deevy.test/hooks/sock_stub00000")).toBeTruthy();

    // Or GitLab's own signing token, which signs every delivery, pasted back.
    fireEvent.change(secret("Signing token"), {
      target: { value: "whsec_Z2l0bGFiLXNpZ25pbmc=" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use the signing token" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    expect(calls.update.mock.calls[0]?.[0]).toEqual({
      socketId: stubSocket.id,
      webhookSecret: "whsec_Z2l0bGFiLXNpZ25pbmc=",
    });
  });

  it("names no instance when it is gitlab.com, which is what a Socket assumes", async () => {
    state.sockets = [];
    calls.connect.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: "Connect GitLab" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme on GitLab" } });
    fireEvent.change(secret("Access token"), {
      target: { value: "glpat-pasted-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toMatchObject({ config: {} });
  });
});

describe("connecting Notion", () => {
  it("takes the integration's secret, then says where Notion sends its webhook", async () => {
    state.sockets = [];
    calls.connect.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: "Connect Notion" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme's Notion" } });
    fireEvent.change(secret("Internal integration secret"), {
      target: { value: "ntn_pasted_secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toEqual({
      provider: "notion",
      name: "Acme's Notion",
      credentials: { token: "ntn_pasted_secret" },
    });
    // Notion answers a subscription with a token of its own, which the
    // Socket's page shows for pasting back.
    expect(await screen.findByText("https://deevy.test/hooks/sock_stub00000")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the Socket's page" })).toBeTruthy();
  });
});

describe("connecting Linear", () => {
  it("names the addresses Linear's app needs, then takes the app's own client", async () => {
    state.sockets = [];
    calls.begin.mockClear();
    calls.connect.mockClear();
    calls.install.mockClear();
    calls.left = [];
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: "Connect Linear" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme on Linear" } });
    fireEvent.click(screen.getByRole("button", { name: "Show the addresses" }));

    // Where Linear sends deliveries, and the two places it sends a browser back
    // to: a Human linking their account, and an admin installing the app.
    expect(await screen.findByText("https://deevy.test/hooks/sock_pending0000")).toBeTruthy();
    const callbacks = screen.getByLabelText("Callback URLs");
    expect(callbacks.textContent).toContain("https://deevy.test/api/identities/linear/callback");
    expect(callbacks.textContent).toContain("https://deevy.test/hooks/sock_pending0000/setup");

    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "lin_client_id" } });
    fireEvent.change(secret("Client secret"), {
      target: { value: "lin_client_secret" },
    });
    fireEvent.change(secret("Webhook signing secret"), {
      target: { value: "lin_wh_signing_secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toEqual({
      provider: "linear",
      name: "Acme on Linear",
      socketId: "sock_pending0000",
      credentials: { clientId: "lin_client_id", clientSecret: "lin_client_secret" },
      webhookSecret: "lin_wh_signing_secret",
    });

    // Connected, and one more thing an admin may want: letting people assign
    // an issue to deevy, which is an install only Linear's own page can do.
    fireEvent.click(await screen.findByRole("button", { name: "Install deevy as an agent" }));
    await waitFor(() =>
      expect(calls.left).toEqual(["https://linear.app/oauth/authorize?actor=app"]),
    );
    expect(calls.install.mock.calls[0]?.[0]).toEqual({ socketId: stubSocket.id });
  });
});

describe("one Socket's own page", () => {
  it("says where the tool delivers, and points a GitHub App there again when the address moved", async () => {
    calls.rewire.mockClear();
    state.sockets = [
      {
        ...stubSocket,
        provider: "github",
        name: "acme on GitHub",
        inboundUrl: "https://deevy.test/hooks/sock_stub00000",
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const delivers = await screen.findByRole("region", { name: "Where it delivers" });
    expect(within(delivers).getByText("https://deevy.test/hooks/sock_stub00000")).toBeTruthy();
    fireEvent.click(within(delivers).getByRole("button", { name: "Point GitHub at this address" }));

    await waitFor(() => expect(calls.rewire).toHaveBeenCalledTimes(1));
    expect(calls.rewire.mock.calls[0]?.[0]).toEqual({ socketId: stubSocket.id });
    expect(await within(delivers).findByText(/GitHub delivers here now/)).toBeTruthy();
  });

  it("says where a GitHub App is installed, and how to install it on more", async () => {
    state.sockets = [
      {
        ...stubSocket,
        provider: "github",
        name: "acme on GitHub",
        config: {
          slug: "deevy-acme",
          htmlUrl: "https://github.test/apps/deevy-acme",
          installations: [{ id: "61892041", account: "acme" }],
        },
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const installed = await screen.findByRole("region", { name: "Where it is installed" });
    expect(within(installed).getByText("acme")).toBeTruthy();
    // GitHub's own page, since installing is GitHub's to do: the first real
    // walk found no way from here to it.
    expect(
      within(installed)
        .getByRole("link", { name: "Install it on more repositories" })
        .getAttribute("href"),
    ).toBe("https://github.test/apps/deevy-acme/installations/new");
  });

  it("says a GitHub App installed nowhere can work nothing yet", async () => {
    state.sockets = [
      {
        ...stubSocket,
        provider: "github",
        name: "acme on GitHub",
        config: { slug: "deevy-acme", htmlUrl: "https://github.test/apps/deevy-acme" },
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const installed = await screen.findByRole("region", { name: "Where it is installed" });
    expect(within(installed).getByText(/Installed nowhere yet/)).toBeTruthy();
    expect(within(installed).getByRole("link", { name: "Install it" }).getAttribute("href")).toBe(
      "https://github.test/apps/deevy-acme/installations/new",
    );
  });

  it("leaves the address for an admin to paste where the tool keeps it itself", async () => {
    state.sockets = [
      {
        ...stubSocket,
        provider: "linear",
        name: "Acme on Linear",
        inboundUrl: "https://deevy.test/hooks/sock_stub00000",
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const delivers = await screen.findByRole("region", { name: "Where it delivers" });

    expect(within(delivers).queryByRole("button", { name: /Point/ })).toBeNull();
    expect(within(delivers).getByText(/paste it into/i)).toBeTruthy();
  });

  it("shows the token Notion sent, to paste back, until a delivery proves it", async () => {
    calls.update.mockClear();
    state.sockets = [
      {
        ...stubSocket,
        provider: "notion",
        name: "Acme's Notion",
        hasWebhookSecret: true,
        config: { webhookVerified: false },
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const verifying = await screen.findByRole("region", { name: "Verifying the webhook" });
    expect(within(verifying).queryByText("secret_notion-verification-token-for-tests")).toBeNull();
    fireEvent.click(within(verifying).getByRole("button", { name: "Show the token" }));

    expect(
      await within(verifying).findByText("secret_notion-verification-token-for-tests"),
    ).toBeTruthy();
    // Notion has no account to link, so an admin may let a verified address
    // vouch for who commented (ADR-0025).
    fireEvent.click(screen.getByRole("switch", { name: "Take a verified address as proof" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    expect(calls.update.mock.calls[0]?.[0]).toEqual({
      socketId: stubSocket.id,
      identityByEmail: true,
    });
  });

  it("says Notion's webhook is verified once it is, and waits for the token before", async () => {
    state.sockets = [
      {
        ...stubSocket,
        provider: "notion",
        name: "Acme's Notion",
        config: { webhookVerified: true },
      },
    ];
    await mountAt(`/settings/sockets/${stubSocket.id}`);
    expect(await screen.findByText(/Notion has verified this webhook/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show the token" })).toBeNull();
  });

  it("offers a Linear Socket's install until it is done, and says so after", async () => {
    calls.install.mockClear();
    calls.left = [];
    state.sockets = [{ ...stubSocket, provider: "linear", name: "Acme on Linear", config: {} }];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Install deevy as an agent" }));

    await waitFor(() => expect(calls.install).toHaveBeenCalledTimes(1));
    expect(calls.left).toEqual(["https://linear.app/oauth/authorize?actor=app"]);
  });

  it("offers no install before the Socket is connected, since there is no client to install", async () => {
    state.sockets = [
      { ...stubSocket, provider: "linear", name: "Acme on Linear", status: "pending", config: {} },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);

    expect(await screen.findByText("Not connected yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install deevy as an agent" })).toBeNull();
  });

  it("says a Linear Socket people can assign issues to, rather than offering it again", async () => {
    state.sockets = [
      { ...stubSocket, provider: "linear", name: "Acme on Linear", config: { assignable: true } },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);

    expect(await screen.findByText(/People can assign an issue to deevy/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install deevy as an agent" })).toBeNull();
  });

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

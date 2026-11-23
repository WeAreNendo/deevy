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
  /** Makes the providers' answer an error, as a server that cannot be reached gives. */
  providersFail: false,
  /** What the stub provider says of its webhook secret, for the page to follow. */
  stubSecretFrom: "either" as "either" | "tool" | "handshake",
  /** Why the GitHub module will not begin here, as it says on a GitHub Enterprise Server. */
  githubBeginRefusal: null as string | null,
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubSocket } = await import("./stub-client.ts");
  const client = stubClient({
    sockets: {
      providers: async () =>
        state.providersFail
          ? Promise.reject(new Error("Failed to fetch"))
          : state.providersPending
            ? new Promise<never>(() => undefined)
            : {
                // Who makes each one's webhook secret is the module's word, and
                // what the Socket's page offers to change it follows it.
                providers: [
                  {
                    id: "github",
                    label: "GitHub",
                    capabilities: ["tracker"],
                    webhookSecretFrom: "either",
                    beginRefusal: state.githubBeginRefusal,
                  },
                  {
                    id: "gitlab",
                    label: "GitLab",
                    capabilities: ["tracker"],
                    webhookSecretFrom: "either",
                  },
                  {
                    id: "linear",
                    label: "Linear",
                    capabilities: ["tracker"],
                    webhookSecretFrom: "tool",
                  },
                  {
                    id: "notion",
                    label: "Notion",
                    capabilities: ["tracker"],
                    webhookSecretFrom: "handshake",
                  },
                  {
                    id: "slack",
                    label: "Slack",
                    capabilities: ["chat"],
                    webhookSecretFrom: "tool",
                  },
                  {
                    id: "stub",
                    label: "the stub tracker",
                    capabilities: ["tracker"],
                    webhookSecretFrom: state.stubSecretFrom,
                  },
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

const { mount, mountAt } = await import("./mount.tsx");

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
  state.providersFail = false;
  state.stubSecretFrom = "either";
  state.githubBeginRefusal = null;
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

  it("makes the App on an organization when one is named, so its repositories can install it", async () => {
    state.sockets = [];
    calls.begin.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme on GitHub" } });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "acme-inc" } });
    // Who GitHub lets make an App there, said before anybody is sent to a 404.
    expect(screen.getByText(/owner of the organization/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create the App on GitHub" }));

    await waitFor(() => expect(calls.begin).toHaveBeenCalledTimes(1));
    // A private App installs only on the account that owns it: made on the
    // person's own account, an organization's repositories could never have it.
    const form = await screen.findByRole("form", { name: "Create the App on GitHub" });
    expect(form.getAttribute("action")).toBe(
      "https://github.com/organizations/acme-inc/settings/apps/new?state=1790000000000.abc",
    );
    expect(within(form).getByText(/acme-inc/)).toBeTruthy();
    const manifest = JSON.parse(
      (within(form).getByTestId("manifest") as HTMLInputElement).value,
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ name: "acme on GitHub", public: false });
  });

  it("refuses an organization GitHub would never have called that", async () => {
    state.sockets = [];
    calls.begin.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme on GitHub" } });
    const organization = screen.getByLabelText("Organization");
    const create = screen.getByRole("button", { name: "Create the App on GitHub" });

    // GitHub's own rule for a login: letters, digits and single hyphens, never
    // at either end, and no more than 39 of them.
    for (const typed of ["acme_inc", "-acme", "acme-", "acme--inc", "acme inc", "a".repeat(40)]) {
      fireEvent.change(organization, { target: { value: typed } });
      expect(organization.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByRole("alert").textContent).toMatch(/login/);
      expect(create.hasAttribute("disabled")).toBe(true);
    }
    for (const typed of ["acme", "Acme-Inc", "a".repeat(39), "  acme  "]) {
      fireEvent.change(organization, { target: { value: typed } });
      expect(organization.getAttribute("aria-invalid")).toBeNull();
      expect(create.hasAttribute("disabled")).toBe(false);
    }
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

  it("offers only the paste where this deevy's GitHub is a GitHub Enterprise Server", async () => {
    state.sockets = [];
    // The server's word rather than a guess from an address: the page's policy
    // lets the manifest's form go only to github.com, so deevy cannot make it.
    state.githubBeginRefusal = "deevy can make a GitHub App for you only on github.com.";
    calls.begin.mockClear();
    calls.connect.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));

    expect(screen.queryByRole("button", { name: "Create the App on GitHub" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make a new App instead" })).toBeNull();
    expect(
      screen.getByText(/On GitHub Enterprise Server or GHE.com, .* paste it here/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme on GHES" } });
    fireEvent.change(screen.getByLabelText("App id"), { target: { value: "17" } });
    fireEvent.change(screen.getByLabelText("Private key"), {
      target: { value: "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toMatchObject({
      provider: "github",
      config: { appId: "17" },
    });
    expect(calls.begin).not.toHaveBeenCalled();
  });

  it("offers no way in until it knows which GitHub deevy works with", async () => {
    // Offered before the answer, Create would be a form the browser refuses
    // on a GitHub Enterprise Server; so nothing is offered until it comes.
    state.providersPending = true;
    const { ConnectGithub } = await import("../src/components/connect-github.tsx");
    mount(<ConnectGithub onConnected={() => undefined} />);

    expect(await screen.findByText(/Checking which GitHub deevy works with/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create the App on GitHub" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste an App you already have" })).toBeNull();
  });

  it("says it could not tell which GitHub, rather than guessing, when the server will not say", async () => {
    state.providersFail = true;
    const { ConnectGithub } = await import("../src/components/connect-github.tsx");
    mount(<ConnectGithub onConnected={() => undefined} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not tell which GitHub/);
    expect(screen.queryByRole("button", { name: "Create the App on GitHub" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
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
    // Only the scopes a method deevy calls needs: a click names who clicked,
    // so nothing asks Slack about people (users:read).
    expect(text).toMatch(/bot:\n\s+- chat:write\n\s+- im:write\n\s+- commands\n/);
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
  it("takes an internal connection's token, then says where Notion sends its webhook", async () => {
    state.sockets = [];
    calls.connect.mockClear();
    await mountAt("/settings/sockets");

    fireEvent.click(await screen.findByRole("button", { name: "Connect Notion" }));
    // Where Notion keeps internal connections since it renamed integrations.
    expect(
      screen.getByRole("link", { name: "Notion's Developer portal" }).getAttribute("href"),
    ).toBe("https://app.notion.com/developers/connections");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme's Notion" } });
    fireEvent.change(secret("Installation access token"), {
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

  it("sends somebody to install the App only on the page GitHub said is its own", async () => {
    // A slug alone says nothing about which GitHub the App is on: on a GitHub
    // Enterprise Server, github.com/apps/<slug> is somebody else's App or none.
    state.sockets = [
      {
        ...stubSocket,
        provider: "github",
        name: "acme on GitHub Enterprise",
        config: { slug: "deevy-acme", installations: [{ id: "7", account: "acme" }] },
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const installed = await screen.findByRole("region", { name: "Where it is installed" });
    expect(within(installed).getByText("acme")).toBeTruthy();
    expect(within(installed).queryByRole("link")).toBeNull();
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
    // Only what deevy has been told: binding a Project asks GitHub, so an App
    // installed before it was connected is not called installed nowhere.
    expect(within(installed).getByText(/Installed nowhere deevy knows of/)).toBeTruthy();
    expect(
      within(installed).getByText(/Ask who deevy is there brings this up to date/),
    ).toBeTruthy();
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
    // vouch for who commented (ADR-0025). The weaker proof is marked on the
    // Gate's page alone, and the sentence says so rather than "wherever it is
    // shown", which Slack, the feed and the tracker's comment never were.
    const commented = screen.getByRole("region", { name: "Who commented" });
    expect(
      within(commented).getByText(/the Gate's page marks every ruling made this way “\(email\)”/),
    ).toBeTruthy();
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

  it("says to check the webhook when the tool has gone quiet, and never that deevy asks", async () => {
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

    // deevy asks no tool what changed (docs/plans/simplify.md, slice 4), so a
    // tool gone quiet may be one whose deliveries no longer arrive, and only
    // its webhook settings and its own redelivery can put that right.
    expect(await screen.findByText(/deevy hears only what it delivers/)).toBeTruthy();
    expect(screen.queryByText(/asks? the tool|asking it/)).toBeNull();
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

  it.each([
    ["Slack", "slack", /Basic Information/],
    ["Linear", "linear", /OAuth application/],
  ] as const)(
    "takes the new secret %s made, since deevy cannot mint one it would take",
    async (tool, provider, where) => {
      calls.update.mockClear();
      calls.rotate.mockClear();
      state.sockets = [
        { ...stubSocket, provider, name: `Acme on ${tool}`, hasWebhookSecret: true, config: {} },
      ];

      await mountAt(`/settings/sockets/${stubSocket.id}`);
      const signs = await screen.findByRole("region", { name: "What it signs with" });
      // The tool makes its own secret and has nowhere to paste one: a minted
      // one would only ever refuse every delivery.
      expect(within(signs).queryByRole("button", { name: "Mint a webhook secret" })).toBeNull();
      expect(within(signs).getByText(where)).toBeTruthy();
      // The old one stays good for a day (PREVIOUS_SECRET_MS), so it does not
      // matter which side changes first.
      expect(within(signs).getByText(/old one for a day/)).toBeTruthy();

      fireEvent.change(secret(`New secret from ${tool}`), {
        target: { value: " 8f14e45fceea167a5a36dedd4bea2543 " },
      });
      fireEvent.click(within(signs).getByRole("button", { name: "Use the new secret" }));

      await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
      expect(calls.update.mock.calls[0]?.[0]).toEqual({
        socketId: stubSocket.id,
        webhookSecret: "8f14e45fceea167a5a36dedd4bea2543",
      });
      expect(await within(signs).findByText(/checks deliveries against the new one/)).toBeTruthy();
      expect(calls.rotate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["GitHub", "github"],
    ["GitLab", "gitlab"],
  ] as const)(
    "offers %s both ways: the secret it has now, or one deevy mints",
    async (tool, provider) => {
      calls.update.mockClear();
      calls.rotate.mockClear();
      state.sockets = [
        { ...stubSocket, provider, name: `acme on ${tool}`, hasWebhookSecret: true, config: {} },
      ];

      await mountAt(`/settings/sockets/${stubSocket.id}`);
      const signs = await screen.findByRole("region", { name: "What it signs with" });

      fireEvent.change(secret(`New secret from ${tool}`), {
        target: { value: "whsec_typed_into_the_tool" },
      });
      fireEvent.click(within(signs).getByRole("button", { name: "Use the new secret" }));
      await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
      expect(calls.update.mock.calls[0]?.[0]).toEqual({
        socketId: stubSocket.id,
        webhookSecret: "whsec_typed_into_the_tool",
      });

      fireEvent.click(within(signs).getByRole("button", { name: "Mint a webhook secret" }));
      await waitFor(() => expect(calls.rotate).toHaveBeenCalledTimes(1));
      expect(await within(signs).findByText("whsec_said_exactly_once")).toBeTruthy();
      // A minted one leaves the old good for a day too, as a pasted one does.
      expect(
        within(signs).getByText(new RegExp(`Paste it into ${tool}: deevy takes the old one`)),
      ).toBeTruthy();
    },
  );

  it("offers what the tool says of its secret, not what the page assumes of its name", async () => {
    calls.rotate.mockClear();
    // The stub, saying it makes its own: the page has no sentence for it, and
    // follows the server's word rather than a list of its own.
    state.stubSecretFrom = "tool";
    state.sockets = [{ ...stubSocket, name: "Example tracker", hasWebhookSecret: true }];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    const signs = await screen.findByRole("region", { name: "What it signs with" });

    expect(within(signs).getByText(/the stub tracker makes it/)).toBeTruthy();
    expect(within(signs).getByLabelText("New secret from the stub tracker")).toBeTruthy();
    expect(within(signs).queryByRole("button", { name: "Mint a webhook secret" })).toBeNull();
  });

  it("offers nothing to change the secret until the server has said who makes it", async () => {
    state.providersPending = true;
    state.sockets = [{ ...stubSocket, name: "Example tracker", hasWebhookSecret: true }];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    expect(await screen.findByRole("heading", { name: "Example tracker" })).toBeTruthy();

    expect(screen.queryByRole("region", { name: "What it signs with" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mint a webhook secret" })).toBeNull();
  });

  it("offers a Notion Socket no secret of deevy's, since Notion signs with its verification token", async () => {
    state.sockets = [
      {
        ...stubSocket,
        provider: "notion",
        name: "Acme's Notion",
        hasWebhookSecret: true,
        config: { webhookVerified: true },
      },
    ];

    await mountAt(`/settings/sockets/${stubSocket.id}`);
    expect(await screen.findByRole("region", { name: "Verifying the webhook" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What it signs with" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mint a webhook secret" })).toBeNull();
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

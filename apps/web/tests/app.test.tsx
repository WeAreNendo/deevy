import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

interface StubProvider {
  id: string;
  label: string;
  kind: "social";
}

const github: StubProvider = { id: "github", label: "GitHub", kind: "social" };
/** Every provider deevy knows, in its default order (packages/core/src/auth.ts). */
const everyProvider: StubProvider[] = [
  github,
  { id: "google", label: "Google", kind: "social" },
  { id: "microsoft", label: "Microsoft", kind: "social" },
  { id: "gitlab", label: "GitLab", kind: "social" },
  { id: "linear", label: "Linear", kind: "social" },
  { id: "slack", label: "Slack", kind: "social" },
  { id: "atlassian", label: "Atlassian", kind: "social" },
  { id: "oidc", label: "Acme SSO", kind: "social" },
];
const stub = vi.hoisted(() => ({
  devSignIn: false,
  providers: [{ id: "github", label: "GitHub", kind: "social" }] as StubProvider[],
  /** The ping fails: the instance is unreachable rather than unconfigured. */
  unreachable: false,
  /** What `authClient.signIn.social` answers — an error is a button that did not start. */
  signInError: null as { message: string } | null,
  /** The provider the `lastLoginMethod` cookie names, as the client plugin reads it. */
  lastUsed: null as string | null,
}));

vi.mock("../src/lib/auth.ts", () => ({
  authClient: {
    signIn: { social: async () => ({ data: null, error: stub.signInError }) },
    getLastUsedLoginMethod: () => stub.lastUsed,
  },
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    health: {
      ping: async () => {
        if (stub.unreachable) throw new Error("unreachable");
        return {
          ok: true,
          time: new Date(0).toISOString(),
          devSignIn: stub.devSignIn,
          providers: stub.providers,
        };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

/**
 * The sign-in buttons' accessible names, in the order they appear. The name
 * matcher is called once per button, in document order, which is the order a
 * keyboard or a screen reader meets them.
 */
function signInButtons(): string[] {
  const names: string[] = [];
  screen.queryAllByRole("button", {
    name: (name) => {
      if (!name.startsWith("Continue with ")) return false;
      names.push(name);
      return true;
    },
  });
  return names;
}

const { DevSignIn, SignedOut } = await import("../src/App.tsx");
const { mount } = await import("./mount.tsx");
const { orpc } = await import("../src/lib/orpc.ts");

afterEach(() => {
  stub.devSignIn = false;
  stub.providers = [github];
  stub.unreachable = false;
  stub.signInError = null;
  stub.lastUsed = null;
  vi.unstubAllGlobals();
});

describe("SignedOut", () => {
  it("offers the providers this deployment configured, and nothing else", async () => {
    const { queryClient } = mount(<SignedOut />);
    expect(await screen.findByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
    // The form's absence means something only once health.ping has answered.
    await waitFor(() =>
      expect(queryClient.getQueryState(orpc.health.ping.queryKey())?.status).toBe("success"),
    );
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("renders one button per provider, in the order the server sent", async () => {
    stub.providers = [github, { id: "google", label: "Google", kind: "social" }];
    mount(<SignedOut />);
    await screen.findByRole("button", { name: "Continue with Google" });
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Continue with GitHub",
      "Continue with Google",
    ]);
  });

  it("dresses each provider's button in its own brand, and a generic one in deevy's", async () => {
    stub.providers = everyProvider;
    mount(<SignedOut />);
    fireEvent.click(await screen.findByRole("button", { name: "More ways to sign in" }));
    await screen.findByRole("button", { name: "Continue with Acme SSO" });

    for (const [name, provider] of [
      ["GitHub", "github"],
      ["Google", "google"],
      ["Microsoft", "microsoft"],
      ["GitLab", "gitlab"],
      ["Linear", "linear"],
      ["Slack", "slack"],
      ["Atlassian", "atlassian"],
    ] as const) {
      const button = screen.getByRole("button", { name: `Continue with ${name}` });
      expect(button.dataset.brand).toBe(provider);
      // The mark is decoration: the name stays "Continue with …", which is
      // what every test and every screen reader reads.
      const mark = button.querySelector(`svg[data-mark="${provider}"]`);
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
    }
    // Google's G, Microsoft's four squares and Slack's hash are each drawn in
    // four colours, as their owners' guidelines want them, never in one.
    for (const name of ["Google", "Microsoft", "Slack"]) {
      const shapes = screen
        .getByRole("button", { name: `Continue with ${name}` })
        .querySelectorAll("svg[data-mark] [fill]");
      expect(new Set([...shapes].map((shape) => shape.getAttribute("fill"))).size).toBe(4);
    }
    // An OpenID Connect IdP could be anybody's, so it has no brand to borrow.
    const generic = screen.getByRole("button", { name: "Continue with Acme SSO" });
    expect(generic.dataset.brand).toBeUndefined();
    expect(generic.querySelector("svg[data-mark]")).toBeNull();
  });

  /**
   * Eight buttons is a wall. Three are what most people sign in with, in the
   * order the server sent (the operator's, else deevy's), and the rest wait
   * behind one disclosure — the single sign-on last, a row of its own, since
   * its name is whatever the operator called it.
   */
  it("shows three, and the rest behind More ways to sign in, the single sign-on last", async () => {
    stub.providers = everyProvider;
    mount(<SignedOut />);
    const more = await screen.findByRole("button", { name: "More ways to sign in" });
    expect(signInButtons()).toEqual([
      "Continue with GitHub",
      "Continue with Google",
      "Continue with Microsoft",
    ]);
    expect(more.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(more);
    await screen.findByRole("button", { name: "Continue with Acme SSO" });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(signInButtons()).toEqual([
      "Continue with GitHub",
      "Continue with Google",
      "Continue with Microsoft",
      "Continue with GitLab",
      "Continue with Linear",
      "Continue with Slack",
      "Continue with Atlassian",
      "Continue with Acme SSO",
    ]);
  });

  it("files the single sign-on last behind More even when the server lists it earlier", async () => {
    stub.providers = [
      github,
      { id: "google", label: "Google", kind: "social" },
      { id: "microsoft", label: "Microsoft", kind: "social" },
      { id: "oidc", label: "Acme SSO", kind: "social" },
      { id: "gitlab", label: "GitLab", kind: "social" },
    ];
    mount(<SignedOut />);
    fireEvent.click(await screen.findByRole("button", { name: "More ways to sign in" }));
    await screen.findByRole("button", { name: "Continue with Acme SSO" });
    expect(signInButtons().slice(3)).toEqual(["Continue with GitLab", "Continue with Acme SSO"]);
  });

  it("keeps the single sign-on in view when the operator put it in the first three", async () => {
    stub.providers = [
      { id: "oidc", label: "Acme SSO", kind: "social" },
      ...everyProvider.slice(0, 7),
    ];
    mount(<SignedOut />);
    await screen.findByRole("button", { name: "More ways to sign in" });
    expect(signInButtons()).toEqual([
      "Continue with Acme SSO",
      "Continue with GitHub",
      "Continue with Google",
    ]);
  });

  it("shows every provider when there are four or fewer, with nothing to expand", async () => {
    stub.providers = everyProvider.slice(0, 4);
    mount(<SignedOut />);
    await screen.findByRole("button", { name: "Continue with GitLab" });
    expect(signInButtons()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "More ways to sign in" })).toBeNull();
  });

  /**
   * The `lastLoginMethod` cookie says which button this browser used last, so
   * that one comes first and says so — even when it would otherwise wait
   * behind More. The badge is its description, not part of its name.
   */
  it("puts the provider this browser used last first, and says so", async () => {
    stub.providers = everyProvider;
    stub.lastUsed = "slack";
    mount(<SignedOut />);
    const slack = await screen.findByRole("button", { name: "Continue with Slack" });
    expect(signInButtons()).toEqual([
      "Continue with Slack",
      "Continue with GitHub",
      "Continue with Google",
    ]);
    expect(screen.getByRole("button", { description: "Last used" })).toBe(slack);
    expect(screen.getByText("Last used").closest("button")).toBe(slack);
  });

  it("ignores a last-used provider this deployment no longer offers", async () => {
    stub.providers = everyProvider.slice(0, 2);
    stub.lastUsed = "atlassian";
    mount(<SignedOut />);
    await screen.findByRole("button", { name: "Continue with Google" });
    expect(signInButtons()).toEqual(["Continue with GitHub", "Continue with Google"]);
    expect(screen.queryByText("Last used")).toBeNull();
  });

  it("does not badge the only way in", async () => {
    stub.lastUsed = "github";
    mount(<SignedOut />);
    await screen.findByRole("button", { name: "Continue with GitHub" });
    expect(screen.queryByText("Last used")).toBeNull();
  });

  it("says so when the deployment configured no provider at all", async () => {
    stub.providers = [];
    mount(<SignedOut />);
    expect(await screen.findByText(/no sign-in provider has been set up/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the development form only when health.ping says sign-in is stubbed", async () => {
    stub.devSignIn = true;
    mount(<SignedOut />);
    expect(await screen.findByRole("form", { name: "Development sign-in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
  });

  /**
   * An instance that cannot be asked what it offers is not an instance that
   * offers nothing: without this the buttons and the "no provider configured"
   * line are both absent and the card is empty (docs/plans/sign-in.md).
   */
  it("says so when it could not ask what this deployment offers", async () => {
    stub.unreachable = true;
    mount(<SignedOut />);
    expect(await screen.findByText(/couldn’t reach deevy|couldn't reach deevy/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Continue with/ })).toBeNull();
    expect(screen.queryByText(/no sign-in provider has been set up/i)).toBeNull();
  });

  /**
   * A provider the page was told about but Better Auth never registered — a
   * discovery document that could not be fetched at startup leaves exactly
   * this — answers the click with an error rather than a redirect.
   */
  /**
   * The one line slice 4 changed in this component: the dev form is handed the
   * first provider the server offers rather than the word "github", so a
   * stubbed instance configured with only Google can still sign in. Mounting
   * `DevSignIn` directly asserts the prop; this asserts the plumbing.
   */
  it("hands the development form the first provider it offers, not GitHub", async () => {
    stub.devSignIn = true;
    stub.providers = [{ id: "google", label: "Google", kind: "social" }];
    const fetched = vi.fn(async () => new Response(JSON.stringify({ url: null })));
    vi.stubGlobal("fetch", fetched);
    mount(<SignedOut />);

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));

    await waitFor(() => expect(fetched).toHaveBeenCalled());
    const [, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ provider: "google" });
  });

  it("says so when a button does not start a sign-in", async () => {
    stub.signInError = { message: "PROVIDER_NOT_FOUND" };
    mount(<SignedOut />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with GitHub" }));
    expect(await screen.findByText(/couldn’t start sign-in|couldn't start sign-in/)).toBeTruthy();
  });
});

describe("DevSignIn", () => {
  /**
   * The stub makes the OAuth `code` the email address, so the form only has to
   * do what the browser would: start the social sign-in for a `state`, then
   * land on the callback with that state and the email.
   */
  it("starts the social sign-in and lands on the callback with the email as the code", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ url: "https://github.com/login/oauth/authorize?state=s3cret&client_id=x" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const navigate = vi.fn();
    mount(<DevSignIn navigate={navigate} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const landed = new URL(navigate.mock.calls[0]?.[0] as string);
    expect(landed.pathname).toBe("/api/auth/callback/github");
    expect(landed.searchParams.get("state")).toBe("s3cret");
    expect(landed.searchParams.get("code")).toBe("ada@example.com");

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/sign-in/social");
    expect(JSON.parse(init.body as string)).toMatchObject({ provider: "github" });
  });

  /**
   * An MCP client sends a Human who is not signed in to the sign-in page with
   * its authorization's signed query. The form hands the signed part to the
   * sign-in, as the client plugin does for the buttons, so the server resumes
   * the authorization at the callback instead of landing on home.
   */
  it("carries an authorization in progress through the sign-in", async () => {
    window.history.replaceState(
      null,
      "",
      "/?client_id=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcb&ba_param=ba_param&ba_param=client_id&ba_param=redirect_uri&sig=abc&utm=x",
    );
    const fetchSpy = vi.fn(async () =>
      Response.json({ url: "https://github.com/login/oauth/authorize?state=s3cret" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const navigate = vi.fn();
    mount(<DevSignIn navigate={navigate} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const sent = new URLSearchParams(
      (JSON.parse(init.body as string) as { oauth_query: string }).oauth_query,
    );
    expect(sent.get("client_id")).toBe("c1");
    expect(sent.get("redirect_uri")).toBe("http://127.0.0.1:8765/cb");
    expect(sent.get("sig")).toBe("abc");
    expect(sent.getAll("ba_param")).toEqual(["ba_param", "client_id", "redirect_uri"]);
    // Only what was signed: anything else on the page is not the server's to check.
    expect(sent.has("utm")).toBe(false);
    window.history.replaceState(null, "", "/");
  });

  it("sends no authorization from a page that is not partway through one", async () => {
    window.history.replaceState(null, "", "/?invitation=inv_1");
    const fetchSpy = vi.fn(async () =>
      Response.json({ url: "https://github.com/login/oauth/authorize?state=s3cret" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const navigate = vi.fn();
    mount(<DevSignIn navigate={navigate} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("oauth_query");
    window.history.replaceState(null, "", "/");
  });

  /**
   * A deployment can offer more than one provider, and under the stub they all
   * end in the same session, so the form takes the first one it is given
   * rather than naming GitHub (docs/plans/sign-in.md slice 4).
   */
  it("signs in through the provider it was handed", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ url: "https://stub/authorize?state=s3cret" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const navigate = vi.fn();
    mount(<DevSignIn provider="google" navigate={navigate} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(new URL(navigate.mock.calls[0]?.[0] as string).pathname).toBe(
      "/api/auth/callback/google",
    );
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ provider: "google" });
  });

  /**
   * An OpenID Connect provider binds its `id_token` to a nonce, which lives in
   * the authorization URL this form skips past — so the form hands it back in
   * the code for the stub to sign into the token (docs/plans/sign-in.md slice 6).
   */
  it("carries an authorization nonce back in the code", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ url: "https://idp.example/authorize?state=s3cret&nonce=n0nce" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const navigate = vi.fn();
    mount(<DevSignIn provider="oidc" navigate={navigate} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const landed = new URL(navigate.mock.calls[0]?.[0] as string);
    expect(landed.pathname).toBe("/api/auth/callback/oidc");
    expect(landed.searchParams.get("code")).toBe("ada@example.com|n0nce");
  });

  it("says so when the server does not start a sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    const navigate = vi.fn();
    mount(<DevSignIn navigate={navigate} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in as this email" }));
    expect(await screen.findByText(/did not start a sign-in/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});

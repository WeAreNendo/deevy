import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Identity = {
  id: string;
  provider: string;
  instance: string;
  externalLogin: string | null;
  verifiedBy: "sign_in" | "oauth" | "link_code" | "email";
  linkedAt: Date;
  revokedAt: Date | null;
};

const stub = vi.hoisted(() => ({
  identities: [] as Identity[],
  signIns: [] as string[],
  linkable: ["github"] as string[],
  providers: [] as Array<{ id: string; label: string; kind: "social" }>,
  revoked: [] as unknown[],
  restored: [] as unknown[],
  linked: [] as unknown[],
  peeked: [] as unknown[],
  redeemed: [] as unknown[],
  tools: [] as Array<{ socketId: string; provider: string; name: string }>,
  begun: [] as unknown[],
  left: [] as string[],
}));

vi.mock("../src/lib/leave.ts", () => ({
  leaveFor: (url: string) => {
    stub.left.push(url);
  },
}));

vi.mock("../src/lib/auth.ts", () => ({
  authClient: {
    // Better Auth's own link, from the signed-in session: what it writes is
    // the account the resolver reads (packages/core/src/identities.ts).
    linkSocial: async (input: unknown) => {
      stub.linked.push(input);
      return { data: { url: "https://github.com/login/oauth/authorize" }, error: null };
    },
  },
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    health: {
      ping: async () => ({
        ok: true,
        time: new Date(0).toISOString(),
        devSignIn: false,
        devSockets: false,
        providers: stub.providers,
      }),
    },
    identities: {
      list: async () => ({
        identities: stub.identities,
        signIns: stub.signIns,
        linkable: stub.linkable,
        tools: stub.tools,
      }),
      begin: async (input: { socketId: string }) => {
        stub.begun.push(input);
        return { url: "https://linear.app/oauth/authorize?state=sock_linear.signed" };
      },
      revoke: async (input: { identityId: string }) => {
        stub.revoked.push(input);
        stub.identities = stub.identities.map((one) =>
          one.id === input.identityId ? { ...one, revokedAt: new Date() } : one,
        );
        return stub.identities.find((one) => one.id === input.identityId);
      },
      peek: async (input: { code: string }) => {
        stub.peeked.push(input);
        return {
          provider: "slack",
          instance: "T07ACME001",
          externalLogin: "omar",
          socketName: "Acme Slack",
          expiresAt: new Date(Date.now() + 600_000),
        };
      },
      link: async (input: { code: string }) => {
        stub.redeemed.push(input);
        const linked = {
          id: "mid_omar",
          provider: "slack",
          instance: "T07ACME001",
          externalLogin: "omar",
          verifiedBy: "link_code" as const,
          linkedAt: new Date(),
          revokedAt: null,
        };
        stub.identities = [...stub.identities, linked];
        return linked;
      },
      restore: async (input: { identityId: string }) => {
        stub.restored.push(input);
        stub.identities = stub.identities.map((one) =>
          one.id === input.identityId ? { ...one, revokedAt: null } : one,
        );
        return stub.identities.find((one) => one.id === input.identityId);
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

beforeEach(() => {
  stub.identities = [];
  stub.signIns = [];
  stub.linkable = ["github"];
  stub.providers = [
    { id: "github", label: "GitHub", kind: "social" },
    { id: "google", label: "Google", kind: "social" },
  ];
  stub.revoked = [];
  stub.restored = [];
  stub.linked = [];
  stub.peeked = [];
  stub.redeemed = [];
  stub.tools = [];
  stub.begun = [];
  stub.left = [];
});

describe("Settings › Identities", () => {
  it("lists the accounts that rule as you, how deevy knows each, and unlinks one", async () => {
    stub.signIns = ["github"];
    stub.identities = [
      {
        id: "mid_bob",
        provider: "github",
        instance: "github.com",
        externalLogin: "bob",
        verifiedBy: "sign_in",
        linkedAt: new Date("2026-09-20T10:00:00Z"),
        revokedAt: null,
      },
    ];
    await mountAt("/settings/identities", { memberName: "Bob" });

    const table = await screen.findByRole("table", { name: "Identities" });
    expect(within(table).getByText("GitHub")).toBeTruthy();
    expect(within(table).getByText("@bob")).toBeTruthy();
    expect(within(table).getByText("You sign in with it")).toBeTruthy();

    fireEvent.click(within(table).getByRole("button", { name: "Unlink @bob" }));

    await waitFor(() => expect(stub.revoked).toEqual([{ identityId: "mid_bob" }]));
    // Kept on the list, because the way back is from here.
    fireEvent.click(await screen.findByRole("button", { name: "Link @bob again" }));
    await waitFor(() => expect(stub.restored).toEqual([{ identityId: "mid_bob" }]));
  });

  it("offers to link the account you rule from, when you do not sign in with it", async () => {
    stub.signIns = ["google"];
    await mountAt("/settings/identities", { memberName: "Carol" });

    fireEvent.click(await screen.findByRole("button", { name: "Link GitHub" }));

    await waitFor(() =>
      expect(stub.linked).toEqual([{ provider: "github", callbackURL: "/settings/identities" }]),
    );
    // Google is how Carol signs in, and nothing is ruled from Google.
    expect(screen.queryByRole("button", { name: "Link Google" })).toBeNull();
  });

  it("says there is nothing to link when you already sign in with it", async () => {
    stub.signIns = ["github"];
    await mountAt("/settings/identities", { memberName: "Bob" });

    expect(await screen.findByText(/You sign in with GitHub/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link GitHub" })).toBeNull();
  });

  it("offers nothing to link when no tool connected here takes those accounts", async () => {
    stub.signIns = ["google"];
    stub.linkable = [];
    await mountAt("/settings/identities", { memberName: "Carol" });

    await screen.findByRole("heading", { name: "Identities" });
    expect(screen.queryByRole("region", { name: "Link an account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link GitHub" })).toBeNull();
  });

  it("links a Slack account by the code Slack gave it, naming the account first", async () => {
    await mountAt("/settings/identities", { memberName: "Omar" });

    fireEvent.change(await screen.findByLabelText("Code from Slack"), {
      target: { value: "ABCD-EFGH" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check the code" }));

    // Who it would link, before it does: a code handed over by somebody else
    // is their account, and this is where that shows (ADR-0025).
    expect(await screen.findByText(/in Acme Slack to you/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link @omar to me" })).toBeTruthy();
    expect(stub.redeemed).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Link @omar to me" }));
    await waitFor(() => expect(stub.redeemed).toEqual([{ code: "ABCD-EFGH" }]));
    expect(await screen.findByText("You redeemed a code sent to it")).toBeTruthy();
  });

  it("links a Linear account on Linear's own page", async () => {
    stub.linkable = [];
    stub.tools = [{ socketId: "sock_linear", provider: "linear", name: "Acme on Linear" }];
    await mountAt("/settings/identities", { memberName: "Grace" });

    fireEvent.click(await screen.findByRole("button", { name: "Link Linear" }));

    await waitFor(() => expect(stub.begun).toEqual([{ socketId: "sock_linear" }]));
    expect(stub.left).toEqual(["https://linear.app/oauth/authorize?state=sock_linear.signed"]);
  });

  it("says what happened when a tool sent you back", async () => {
    await mountAt("/settings/identities?linked=linear", { memberName: "Grace" });
    expect(await screen.findByText("Your Linear account is linked.")).toBeTruthy();
  });

  it("says why, when a tool sent you back without linking anything", async () => {
    await mountAt(
      `/settings/identities?linkError=${encodeURIComponent("That link did not start here.")}`,
      { memberName: "Grace" },
    );
    expect(await screen.findByText("That link did not start here.")).toBeTruthy();
  });

  it("is under You in Settings", async () => {
    await mountAt("/settings/identities", { memberName: "Bob" });

    const nav = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(nav).getByRole("link", { name: "Identities" })).toBeTruthy();
  });
});

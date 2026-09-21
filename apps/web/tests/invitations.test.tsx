import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

interface StubInvitation {
  id: string;
  email: string;
  role: "member" | "admin";
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const week = () => new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);

const stub = vi.hoisted(() => ({
  invitations: [] as unknown[],
  created: [] as unknown[],
  revoked: [] as string[],
  accepted: [] as string[],
  /** What `invitations.accept` refuses with, when it refuses. */
  refusal: null as string | null,
  session: null as { user: { email: string } } | null,
  member: null as { id: string; role: string } | null,
}));

vi.mock("../src/lib/auth.ts", () => ({
  authClient: {
    useSession: () => ({ data: stub.session, isPending: false }),
    signOut: vi.fn(),
    signIn: { social: vi.fn() },
  },
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    me: {
      get: async () => ({
        user: { email: stub.session?.user.email ?? "" },
        member: stub.member,
        workspace: stub.member ? { id: "w1", name: "Acme Team" } : null,
        principal: "cookie",
      }),
    },
    invitations: {
      list: async () => ({ invitations: stub.invitations }),
      create: async (input: { email: string; role: string }) => {
        stub.created.push(input);
        return {
          id: "inv-new",
          email: input.email,
          role: input.role,
          expiresAt: week(),
          acceptedAt: null,
          revokedAt: null,
          url: "https://deevy.example.com/invite/s3cret-token",
          path: "/invite/s3cret-token",
        };
      },
      revoke: async (input: { invitationId: string }) => {
        stub.revoked.push(input.invitationId);
        stub.invitations = (stub.invitations as StubInvitation[]).filter(
          (invitation) => invitation.id !== input.invitationId,
        );
        return { id: input.invitationId };
      },
      accept: async (input: { token: string }) => {
        stub.accepted.push(input.token);
        if (stub.refusal) throw new Error(stub.refusal);
        // `me.get` goes on answering "nobody yet": what the Member it returns
        // opens is the whole app, which says nothing about the invitation and
        // would load the router outside `act`. That a Member lands in the
        // Workspace is `shell.test.tsx`.
        return { id: "mem-grace", role: "member" };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const App = (await import("../src/App.tsx")).default;
const { InvitationsRow } = await import("../src/routes/settings/invitations.tsx");
const { mount } = await import("./mount.tsx");
const { invitationInPath } = await import("../src/lib/invitation.ts");

afterEach(() => {
  stub.invitations = [];
  stub.created = [];
  stub.revoked = [];
  stub.accepted = [];
  stub.refusal = null;
  stub.session = null;
  stub.member = null;
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/");
});

describe("the Invited row of Workspace › General", () => {
  it("lists who is still outstanding, with their role and how long they have", async () => {
    stub.invitations = [
      {
        id: "inv-1",
        email: "grace@example.com",
        role: "member",
        expiresAt: week(),
        acceptedAt: null,
        revokedAt: null,
      },
      // Spent and revoked rows are kept by the API; the row shows neither.
      {
        id: "inv-2",
        email: "alan@example.com",
        role: "admin",
        expiresAt: week(),
        acceptedAt: new Date(),
        revokedAt: null,
      },
    ];
    mount(<InvitationsRow />);

    expect(await screen.findByText("grace@example.com")).toBeTruthy();
    expect(screen.queryByText("alan@example.com")).toBeNull();
    expect(screen.getByText("Member")).toBeTruthy();
    expect(screen.getByText(/Expires in/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Revoke the invitation for grace@example.com" }),
    ).toBeTruthy();
  });

  it("shows the link once, in the dialog that made it, and never on a row", async () => {
    mount(<InvitationsRow />);
    // The link the admin copies is built on the origin the browser is on, not
    // the one the API answered with: they are the same in the image and on
    // Workers, and two ports in the dev loop (docs/plans/sign-in.md).
    const url = `${window.location.origin}/invite/s3cret-token`;

    fireEvent.click(await screen.findByRole("button", { name: "Invite someone" }));
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "grace@example.com" },
    });
    // What `invitations.list` answers once the row re-reads it, which creating
    // one makes it do.
    stub.invitations = [
      {
        id: "inv-new",
        email: "grace@example.com",
        role: "member",
        expiresAt: week(),
        acceptedAt: null,
        revokedAt: null,
      },
    ];
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText(url)).toBeTruthy();
    expect(screen.getByText(/only time the link is shown/)).toBeTruthy();
    expect(stub.created).toEqual([{ email: "grace@example.com", role: "member" }]);

    // Closing it is the last of the token: the row that follows carries the
    // address, the role and the expiry, and no link to copy.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText(url)).toBeNull());
    expect(await screen.findByText("grace@example.com")).toBeTruthy();
  });

  it("revokes an invitation from its row", async () => {
    stub.invitations = [
      {
        id: "inv-1",
        email: "grace@example.com",
        role: "member",
        expiresAt: week(),
        acceptedAt: null,
        revokedAt: null,
      },
    ];
    mount(<InvitationsRow />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke the invitation for grace@example.com" }),
    );

    await waitFor(() => expect(stub.revoked).toEqual(["inv-1"]));
    await waitFor(() => expect(screen.queryByText("grace@example.com")).toBeNull());
  });
});

describe("an invitation link", () => {
  it("says one is waiting, and holds its token for the sign-in", async () => {
    window.history.pushState({}, "", "/invite/tok-1");
    mount(<App />);

    expect(await screen.findByText(/You have an invitation waiting/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
    // Held, because signing in leaves the SPA and comes back to "/".
    expect(window.sessionStorage.getItem("deevy.invitation")).toBe("tok-1");
  });

  it("accepts the held token once the Human is signed in and nobody yet", async () => {
    window.sessionStorage.setItem("deevy.invitation", "tok-1");
    window.history.pushState({}, "", "/");
    stub.session = { user: { email: "grace@example.com" } };
    mount(<App />);

    expect(await screen.findByText(/Accepting the invitation you were sent/)).toBeTruthy();
    await waitFor(() => expect(stub.accepted).toEqual(["tok-1"]));
    // Spent: nothing is left to accept in this tab.
    await waitFor(() => expect(window.sessionStorage.getItem("deevy.invitation")).toBeNull());
  });

  it("renders the operation's message when the address does not match", async () => {
    stub.refusal = "That invitation was sent to grace@example.com";
    window.sessionStorage.setItem("deevy.invitation", "tok-1");
    stub.session = { user: { email: "alan@example.com" } };
    mount(<App />);

    expect(await screen.findByText(/That invitation was sent to grace@example.com/)).toBeTruthy();
    // The link is still held, so signing in as the invited address still works.
    expect(window.sessionStorage.getItem("deevy.invitation")).toBe("tok-1");
    expect(screen.getByRole("button", { name: "Sign out and try another account" })).toBeTruthy();
  });
});

describe("the token in the path", () => {
  /**
   * `/invite/%` made `decodeURIComponent` throw inside a render with no error
   * boundary above it, so the Human got a blank page and no way to sign in.
   * The token is base64url, so the path is matched as that rather than decoded
   * (docs/plans/sign-in.md).
   */
  it("reads a token, and refuses a path that is not one", () => {
    expect(invitationInPath("/invite/s3cret-token_AAAAAAAAAAAAAAAAAAAAAAAA")).toBe(
      "s3cret-token_AAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(invitationInPath("/invite/%")).toBeNull();
    expect(invitationInPath("/invite/ab%zz")).toBeNull();
    expect(invitationInPath("/invite/")).toBeNull();
    expect(invitationInPath("/settings/projects")).toBeNull();
  });
});

import { RouterProvider } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MemberChip } from "@/components/member-chip";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth.ts";
import {
  dropInvitation,
  heldInvitation,
  holdInvitation,
  invitationInPath,
} from "@/lib/invitation.ts";
import { orpc } from "@/lib/orpc.ts";
import { RoomsProvider } from "@/lib/rooms.tsx";
import { createAppRouter } from "@/router.tsx";
import type { ShellProps } from "@/routes/shell.tsx";

export default function App() {
  // An invitation link is answered here rather than by the router: whoever
  // holds one is not a Member yet, and the router is only mounted for a Member.
  const [invitation, setInvitation] = useInvitation();
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <Centered>Loading…</Centered>;
  if (!session) return <SignedOut invitation={invitation} />;
  return <SignedIn invitation={invitation} onInvitationDropped={() => setInvitation(null)} />;
}

/**
 * The token `/invite/<token>` carried, read once on the first render and kept
 * for the sign-in that follows (`lib/invitation.ts`), so somebody who clicks
 * the link and then signs in joins, and so does somebody who signs in first
 * and clicks second.
 */
function useInvitation(): [string | null, (token: null) => void] {
  const [token, setToken] = useState(() => {
    const inPath = invitationInPath(window.location.pathname);
    if (inPath) holdInvitation(inPath);
    return inPath ?? heldInvitation();
  });
  // The token is a bearer, and a path is the one place a URL is copied,
  // bookmarked, kept in history and sent as a `Referer`. Once it is held there
  // is nothing left for the address bar to carry (docs/plans/sign-in.md).
  useEffect(() => {
    if (!invitationInPath(window.location.pathname)) return;
    window.history.replaceState(null, "", "/");
  }, []);
  return [token, setToken];
}

export function SignedOut({ invitation = null }: { invitation?: string | null }) {
  // Public, so it answers before anyone is signed in: which providers this
  // deployment configured, and whether sign-in goes through the development
  // stub (DEEVY_DEV_STUB_OAUTH).
  const health = useQuery(orpc.health.ping.queryOptions());
  const providers = health.data?.providers;
  // What a button that did not start says. Better Auth answers a provider it
  // never registered with an error rather than a redirect — the case a
  // discovery document that could not be fetched at startup leaves behind — and
  // without this the click is a silent no-op (docs/plans/sign-in.md).
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <SignInFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        {/* An invitation is a bearer: there is nothing to read without the
            token, so the line says one is waiting and no more than that. */}
        <p className="text-sm text-muted-foreground">
          {invitation
            ? "You have an invitation waiting. Sign in with the address it was sent to."
            : "Use an account your Workspace admin has approved."}
        </p>
      </div>
      {providers?.map((provider) => (
        <Button
          key={provider.id}
          size="lg"
          className="w-full"
          onClick={async () => {
            setFailed(null);
            const started = await authClient.signIn.social({
              provider: provider.id as Parameters<typeof authClient.signIn.social>[0]["provider"],
              callbackURL: home(),
              errorCallbackURL: home(),
            });
            if (started.error) {
              setFailed(
                `We couldn't start sign-in with ${provider.label}. Ask your administrator to check this deployment's configuration.`,
              );
            }
          }}
        >
          Sign in with {provider.label}
        </Button>
      ))}
      {providers?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sign-in provider has been set up yet. Your administrator can add one and restart deevy.
        </p>
      ) : null}
      {/* A page that cannot ask what it offers says so. Without this the
          buttons and the line above are both absent and the card is empty. */}
      {health.isError ? (
        <p className="text-sm text-destructive">
          We couldn&apos;t reach deevy, so there is nothing to sign in with yet. Reload the page to
          try again.
        </p>
      ) : null}
      {failed ? <p className="text-sm text-destructive">{failed}</p> : null}
      {health.data?.devSignIn ? <DevSignIn provider={providers?.[0]?.id ?? "github"} /> : null}
    </SignInFrame>
  );
}

/**
 * Sign in as any email, on an instance whose providers are the stub
 * (apps/web/scripts/stub-oauth.js). It is Better Auth's real OAuth dance with
 * the consent screen skipped: start the social sign-in to get a `state`, then
 * land on the callback with the email as the `code`, exactly as the acceptance
 * walk does over HTTP (apps/claude-agent/scripts/acceptance.ts).
 *
 * It needs no chooser now that a deployment can offer more than one provider:
 * the stub answers for all of them and the address is what decides who signs
 * in, so any offered provider ends in the same session. It takes the first one
 * rather than GitHub by name so a stubbed instance that offers only Google
 * still signs in (docs/plans/sign-in.md).
 *
 * An OpenID Connect sign-in also binds its `id_token` to a nonce, which is in
 * the authorization URL this form skips past. So when the URL carries one, the
 * code carries it too — `email|nonce` — and the stub signs it into the token
 * it hands back (apps/web/scripts/stub-oauth.js).
 */
export function DevSignIn({
  provider = "github",
  navigate = (url: string) => window.location.assign(url),
}: {
  provider?: string;
  navigate?: (url: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      aria-label="Development sign-in"
      className="flex flex-col gap-3 rounded-md border border-dashed p-4"
      onSubmit={async (submitted) => {
        submitted.preventDefault();
        setPending(true);
        setError(null);
        try {
          const started = await fetch("/api/auth/sign-in/social", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ provider, callbackURL: home() }),
          });
          const { url } = (await started.json()) as { url?: string };
          const authorization = url ? new URL(url) : null;
          const state = authorization?.searchParams.get("state") ?? null;
          if (!state) throw new Error("the server did not start a sign-in");
          const nonce = authorization?.searchParams.get("nonce");
          const callback = new URL(`/api/auth/callback/${provider}`, window.location.origin);
          callback.searchParams.set("state", state);
          callback.searchParams.set("code", nonce ? `${email.trim()}|${nonce}` : email.trim());
          navigate(callback.toString());
        } catch (failed) {
          setError(failed instanceof Error ? failed.message : String(failed));
          setPending(false);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Sign-in is a stub on this instance</span>
        <span className="text-xs text-muted-foreground">
          Any email signs in. The one in DEEVY_ADMIN_EMAIL becomes the Workspace admin.
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dev-email">Email</Label>
        <Input
          id="dev-email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(changed) => setEmail(changed.target.value)}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" variant="outline" disabled={pending || !email.trim()}>
        Sign in as this email
      </Button>
    </form>
  );
}

function SignedIn({
  invitation = null,
  onInvitationDropped,
}: {
  invitation?: string | null;
  onInvitationDropped?: () => void;
}) {
  const me = useQuery(orpc.me.get.queryOptions());
  const health = useQuery(orpc.health.ping.queryOptions());
  const context: ShellProps = {
    workspaceName: me.data?.workspace?.name ?? "deevy",
    memberName: me.data?.user.name ?? "",
    ...(me.data?.member
      ? {
          member: {
            id: me.data.member.id,
            kind: me.data.member.kind,
            handle: me.data.member.handle,
            role: me.data.member.role,
            image: me.data.user.image,
          },
        }
      : {}),
  };
  // The router is built once; its context is refreshed as `me` resolves.
  const router = useMemo(() => createAppRouter(context), []);
  router.update({ context });
  // `update` alone does not re-render what is already mounted, so a Workspace
  // renamed on Settings › General never reached the sidebar (Matt, 2026-09-07).
  // Invalidating on the values the shell actually shows does, and only then.
  const shown = `${context.workspaceName}\u0000${context.memberName}\u0000${context.member?.id ?? ""}\u0000${context.member?.image ?? ""}`;
  useEffect(() => {
    void router.invalidate();
  }, [router, shown]);

  if (me.isPending) return <Centered>Loading…</Centered>;
  if (me.isError) return <Centered>Could not load your profile: {me.error.message}</Centered>;

  const { user, member, workspace } = me.data;
  if (!workspace || !member) {
    return (
      <NotAMember
        email={user.email}
        invitation={invitation}
        {...(onInvitationDropped ? { onInvitationDropped } : {})}
      />
    );
  }
  if (member.suspendedAt) return <Suspended email={user.email} />;
  return (
    // One socket for the session, rooms on it per Document (ADR-0021). A
    // deployment without rooms says so on `health.ping`, and every editor
    // stays exactly what it was.
    <RoomsProvider
      enabled={health.data?.liveDocuments === true}
      me={{ id: member.id, name: user.name, kind: member.kind }}
    >
      <RouterProvider router={router} />
    </RoomsProvider>
  );
}

/**
 * Signed in and nobody yet — which is where an invited Human lands, so this
 * screen picks up a held token and accepts it rather than telling everybody
 * who reaches it to go and ask for an allowlist rule.
 */
export function NotAMember({
  email,
  invitation = null,
  onInvitationDropped,
}: {
  email: string;
  invitation?: string | null;
  /** So the tab stops holding what this screen just gave up on. */
  onInvitationDropped?: () => void;
}) {
  const [token, setToken] = useState(invitation);
  if (token) {
    return (
      <AcceptingInvitation
        email={email}
        token={token}
        onGiveUp={() => {
          dropInvitation();
          setToken(null);
          onInvitationDropped?.();
        }}
      />
    );
  }
  return (
    <SignInFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Signed in, not yet a Member</h1>
        <p className="text-sm text-muted-foreground">
          {email} isn&apos;t a Member of this Workspace yet. Ask an admin to invite you, or to
          approve your email domain, GitHub organization or GitLab group — then sign in again.
        </p>
      </div>
      <Button variant="outline" onClick={() => authClient.signOut()}>
        Sign out
      </Button>
    </SignInFrame>
  );
}

/**
 * The invitation being spent. It is accepted once, on arrival — the Human has
 * already chosen by clicking the link and signing in, so a second button
 * saying "yes, really" would be furniture. A refusal is the operation's own
 * message, because only it knows which address the invitation was for.
 */
function AcceptingInvitation({
  email,
  token,
  onGiveUp,
}: {
  email: string;
  token: string;
  onGiveUp: () => void;
}) {
  const queryClient = useQueryClient();
  const accept = useMutation(
    orpc.invitations.accept.mutationOptions({
      onSuccess: async () => {
        // Spent: the row is marked accepted, so holding it any longer would
        // only make the next sign-in in this tab fail on it.
        dropInvitation();
        await queryClient.invalidateQueries({ queryKey: orpc.me.key() });
      },
    }),
  );
  // Once, whatever React does with this component's identity: accepting is a
  // write, and the second call would be answered from the wrong branch.
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    accept.mutate({ token });
  }, [accept, token]);

  if (accept.isError) {
    return (
      <SignInFrame>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">That invitation is not yours yet</h1>
          <p className="text-sm text-muted-foreground">
            {accept.error.message}. You are signed in as {email}.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => authClient.signOut()}>Sign out and try another account</Button>
          <Button variant="outline" onClick={onGiveUp}>
            Continue without it
          </Button>
        </div>
      </SignInFrame>
    );
  }

  return (
    <SignInFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Joining this Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Accepting the invitation you were sent, as {email}…
        </p>
      </div>
    </SignInFrame>
  );
}

export function Suspended({ email }: { email: string }) {
  return (
    <SignInFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Your membership is suspended</h1>
        <p className="text-sm text-muted-foreground">
          Your access to this Workspace is paused. An admin can reinstate {email} at any time.
        </p>
      </div>
      <Button variant="outline" onClick={() => authClient.signOut()}>
        Sign out
      </Button>
    </SignInFrame>
  );
}

// Absolute so Better Auth sends the browser back to the SPA origin (5173 in dev),
// not to its own base URL (the Node server on 3000).
function home(): string {
  return `${window.location.origin}/`;
}

// What the legend shows: not real Members, the four things the colours mean.
const ada = { id: "legend-ada", kind: "human", user: { name: "Ada Lovelace" } } as const;
const planner = {
  id: "legend-planner",
  kind: "agent",
  handle: "planner",
  user: { name: "Planner" },
} as const;

/**
 * Everything outside the app shares this frame (after @shadcn/login-04): the
 * brand and a legend on the left — the one idea the palette encodes, that you
 * can always tell a Human from an Agent and see what waits on a Human — and on
 * the right whatever the visitor has to do: sign in, or read why they cannot.
 */
function SignInFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <section
        aria-label="About deevy"
        className="hidden flex-col justify-between border-r bg-sidebar p-10 lg:flex"
      >
        <Brand />
        <div className="flex max-w-md flex-col gap-6">
          <p className="text-2xl font-medium leading-snug tracking-tight text-balance">
            Project management where Humans and Agents work the same Issues, as peers.
          </p>
          <dl className="flex flex-col gap-3 text-sm">
            <LegendRow term={<MemberChip member={ada} />}>A Human. Round, in copper.</LegendRow>
            <LegendRow term={<MemberChip member={planner} sponsorName="Ada Lovelace" />}>
              An Agent. Squared, in teal, and always sponsored by a Human.
            </LegendRow>
            <LegendRow
              term={<StateBadge state={{ name: "Build", isGate: false, category: "active" }} />}
            >
              A State an Issue moves through.
            </LegendRow>
            <LegendRow
              term={<StateBadge state={{ name: "Intent", isGate: true, category: "active" }} />}
            >
              A Gate: a State only a Human's ruling can pass.
            </LegendRow>
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">
          Agents work over MCP, in the same vocabulary, with the same rights.
        </p>
      </section>
      <section className="flex flex-col p-6 lg:p-10">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-sm flex-col gap-6">{children}</div>
        </div>
      </section>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-primary font-mono text-sm font-semibold text-primary-foreground"
      >
        d
      </span>
      <span className="text-lg font-semibold tracking-tight">deevy</span>
    </div>
  );
}

function LegendRow({ term, children }: { term: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
      <dt className="flex">{term}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 p-6 text-sm text-muted-foreground">
      {children}
    </main>
  );
}

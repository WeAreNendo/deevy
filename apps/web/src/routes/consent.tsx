import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { withBase } from "@/lib/base";

/**
 * The OAuth consent screen (`consentPage` in packages/core/src/auth.ts). Better
 * Auth redirects the browser here with the authorization request as a signed
 * query, and this page hands that same query straight back to
 * `/oauth2/consent`: deevy never re-derives what was asked for, so nothing a
 * Human could edit in the address bar can widen the grant.
 */

/** Where the signed query lives. A test renders this page with one of its own. */
export interface ConsentPageProps {
  search?: string;
}

interface PublicClient {
  client_name?: string | null;
  client_uri?: string | null;
  logo_uri?: string | null;
}

/** What a scope lets a client do, in the words deevy uses for it (CONTEXT.md). */
const scopeSays: Record<string, string> = {
  openid: "Know who you are",
  profile: "See your name and picture",
  email: "See your email address",
  offline_access: "Stay connected when you are away",
};

export function ConsentPage({ search }: ConsentPageProps = {}) {
  const query = new URLSearchParams(search ?? window.location.search);
  const clientId = query.get("client_id") ?? "";
  const scopes = (query.get("scope") ?? "").split(" ").filter(Boolean);

  const client = useQuery({
    queryKey: ["oauth-public-client", clientId],
    enabled: clientId !== "",
    queryFn: async (): Promise<PublicClient> => {
      const res = await fetch(
        withBase(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Could not read who is asking");
      return (await res.json()) as PublicClient;
    },
  });

  const decide = useMutation({
    mutationFn: async (accept: boolean) => {
      const res = await fetch(withBase("/api/auth/oauth2/consent"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oauth_query: query.toString(), accept }),
      });
      const body = (await res.json()) as { url?: string; error_description?: string };
      if (!res.ok || !body.url) throw new Error(body.error_description ?? "Could not answer");
      // Back to the client, with the authorization code or the refusal.
      window.location.assign(body.url);
    },
  });

  if (!clientId) {
    return (
      <section className="mx-auto flex max-w-md flex-col gap-3 py-16">
        <h1 className="text-xl font-semibold">Nothing to consent to</h1>
        <p className="text-sm text-muted-foreground">
          This is where a connected tool asks for permission to act as you. There&apos;s no request
          waiting right now.
        </p>
      </section>
    );
  }

  const name = client.data?.client_name ?? clientId;

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Let {name} act as you?</h1>
        <p className="text-sm text-muted-foreground">
          It will work as you, with access to the same Projects and Issues you can see. It can never
          rule on a Gate for you — that only happens here in deevy.
        </p>
      </header>

      {client.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {client.data?.client_uri ? (
        <p className="text-sm text-muted-foreground">
          Its own page is <span className="font-mono">{client.data.client_uri}</span>
        </p>
      ) : null}
      <p className="font-mono text-xs break-all text-muted-foreground">{clientId}</p>

      {scopes.length > 0 ? (
        <ul
          aria-label="What it is asking for"
          className="flex flex-col gap-2 rounded-md border p-4"
        >
          {scopes.map((scope) => (
            <li key={scope} className="text-sm">
              {scopeSays[scope] ?? scope}
            </li>
          ))}
        </ul>
      ) : null}

      {decide.error ? <p className="text-sm text-destructive">{decide.error.message}</p> : null}

      <div className="flex gap-3">
        <Button disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          Allow
        </Button>
        <Button variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
          Refuse
        </Button>
      </div>
    </section>
  );
}

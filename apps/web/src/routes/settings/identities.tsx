import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";
import { orpc } from "@/lib/orpc";
import { providerLabel } from "@/lib/providers";

/**
 * The accounts on the tools that rule as you (ADR-0025).
 *
 * A comment `/approve` on a GitHub issue counts only when deevy can prove which
 * Human wrote it, and this is where that proof is shown and taken back. An
 * account you sign in to deevy with vouches for you the first time you rule
 * from its tool; one you do not sign in with is linked from here, through the
 * same OAuth grant a sign-in uses.
 */

/** How deevy came to believe an account is yours, in your words rather than its. */
const verifiedByText: Record<string, string> = {
  sign_in: "You sign in with it",
  oauth: "You linked it",
  link_code: "You redeemed a code sent to it",
  email: "Its address matches yours",
};

export function IdentitiesPage() {
  const queryClient = useQueryClient();
  const listed = useQuery(orpc.identities.list.queryOptions({ input: {} }));
  const health = useQuery(orpc.health.ping.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.identities.key() });
  const revoke = useMutation(orpc.identities.revoke.mutationOptions({ onSuccess: refresh }));
  const restore = useMutation(orpc.identities.restore.mutationOptions({ onSuccess: refresh }));
  const [linkFailed, setLinkFailed] = useState<string | null>(null);

  const rows = listed.data?.identities ?? [];
  const signIns = new Set(listed.data?.signIns ?? []);
  // The sign-in providers a tool connected here takes accounts from, and that
  // this deployment offers: anything else would link an account that rules
  // nowhere.
  const takes = new Set(listed.data?.linkable ?? []);
  const linkable = (health.data?.providers ?? []).filter((one) => takes.has(one.id));
  type Row = (typeof rows)[number];

  const columns: DataColumn<Row>[] = [
    {
      id: "tool",
      header: "Tool",
      cell: (row) => (
        <span className="font-medium">
          {providerLabel(row.provider)}
          <span className="block font-mono text-xs text-muted-foreground">{row.instance}</span>
        </span>
      ),
      sortValue: (row) => row.provider,
    },
    {
      id: "account",
      header: "Account",
      cell: (row) => (
        <span className="font-mono text-sm">
          {row.externalLogin ? `@${row.externalLogin}` : "—"}
        </span>
      ),
      className: "w-full",
    },
    {
      id: "how",
      header: "How deevy knows",
      cell: (row) =>
        row.revokedAt ? (
          // Said where the proof would be, because an unlinked account has
          // none: it rules nothing until it is linked again from here.
          <span className="text-muted-foreground">Unlinked, so it rules nothing</span>
        ) : (
          <span className="flex items-center gap-2 text-muted-foreground">
            {verifiedByText[row.verifiedBy] ?? row.verifiedBy}
            {/* Weaker than the rest, and said wherever a Ruling it made is shown. */}
            {row.verifiedBy === "email" ? <Badge variant="outline">email</Badge> : null}
          </span>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (row) => {
        const who = row.externalLogin ? `@${row.externalLogin}` : providerLabel(row.provider);
        return row.revokedAt ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Link ${who} again`}
            disabled={restore.isPending}
            onClick={() => restore.mutate({ identityId: row.id })}
          >
            Link again
          </Button>
        ) : (
          // Outline rather than destructive: an unlinked account can be linked
          // again from this same row (deevy-ui, "Destructive is for what does
          // not undo").
          <Button
            variant="outline"
            size="sm"
            aria-label={`Unlink ${who}`}
            disabled={revoke.isPending}
            onClick={() => revoke.mutate({ identityId: row.id })}
          >
            Unlink
          </Button>
        );
      },
      className: "text-right",
    },
  ];

  return (
    <SettingsPage
      title="Identities"
      description="The accounts on your team's tools that can approve or reject as you, by commenting where the work lives."
    >
      {revoke.error || restore.error ? (
        <p className="text-sm text-destructive">{(revoke.error ?? restore.error)?.message}</p>
      ) : null}
      {listed.isError ? (
        <p className="text-sm text-destructive">
          Could not load your identities: {listed.error.message}
        </p>
      ) : (
        <DataTable
          aria-label="Identities"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={listed.isPending}
          empty={{
            icon: Fingerprint,
            title: "No linked accounts yet",
            description:
              "The first time you comment /approve or /reject from an account deevy can vouch for, it appears here.",
          }}
        />
      )}

      {linkable.length > 0 ? (
        <SettingsSection aria-label="Link an account" title="Link an account">
          <p className="text-sm text-muted-foreground">
            Comment <code>/approve</code> or <code>/reject</code> on a record and it counts as you
            once deevy knows the account is yours.
          </p>
          <ul className="flex flex-col gap-2">
            {linkable.map((provider) =>
              signIns.has(provider.id) ? (
                <li key={provider.id} className="text-sm">
                  You sign in with {provider.label}, so your comments there already count.
                </li>
              ) : (
                <li key={provider.id}>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      setLinkFailed(null);
                      const started = await authClient.linkSocial({
                        provider: provider.id as Parameters<
                          typeof authClient.linkSocial
                        >[0]["provider"],
                        callbackURL: "/settings/identities",
                      });
                      if (started.error) {
                        setLinkFailed(`We couldn't start linking ${provider.label}. Try again.`);
                      }
                    }}
                  >
                    Link {provider.label}
                  </Button>
                </li>
              ),
            )}
          </ul>
          {linkFailed ? <p className="text-sm text-destructive">{linkFailed}</p> : null}
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}

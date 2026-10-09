import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsRow } from "@/components/settings-page";
import { orpc } from "@/lib/orpc.ts";
import { appURL } from "@/lib/base";

type Role = "member" | "admin";

const roleLabels = { member: "Member", admin: "Admin" } as const;

/** An invitation shows how long it has left, and says so when it has none. */
function lifeLeft(expiresAt: Date | string): string {
  const on = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(on.getTime())) return "";
  if (on.getTime() <= Date.now()) return "Expired";
  return `Expires ${formatDistanceToNowStrict(on, { addSuffix: true })}`;
}

/**
 * Who is invited, beside who may join (docs/plans/sign-in.md slice 8). A rule
 * admits a category and an invitation admits a person, so the two facts about
 * getting in sit in the same place, one row apart.
 *
 * `invitations.list` returns spent and revoked invitations too; this row shows
 * the ones that still hold an address — accepted ones are Members now, and a
 * revoked one is history. An expired invitation is still shown, because it
 * still holds the address until it is revoked.
 */
export function InvitationsRow() {
  const queryClient = useQueryClient();
  const invitations = useQuery(orpc.invitations.list.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.invitations.key() });

  const [inviting, setInviting] = useState(false);
  const revoke = useMutation(orpc.invitations.revoke.mutationOptions({ onSuccess: refresh }));

  const outstanding = (invitations.data?.invitations ?? []).filter(
    (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
  );

  return (
    <SettingsRow
      label="Invited"
      hint={
        outstanding.length === 0 && !invitations.isPending
          ? "Invite someone by email to bring them in one at a time, even if they don't match any of your rules."
          : "These people have been invited and haven't joined yet. An invitation works whether or not they match your rules."
      }
      below={
        outstanding.length > 0 ? (
          <ul aria-label="Invitations" className="flex flex-col divide-y rounded-md border bg-card">
            {outstanding.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{invitation.email}</span>
                <span className="text-muted-foreground">{roleLabels[invitation.role as Role]}</span>
                <span className="text-xs text-muted-foreground">
                  {lifeLeft(invitation.expiresAt)}
                </span>
                {/* Whether the link went by email, when it was sent that way. */}
                {invitation.emailStatus === "sent" ? (
                  <span className="text-xs text-muted-foreground">Emailed</span>
                ) : invitation.emailStatus === "queued" ? (
                  <span className="text-xs text-muted-foreground">Email on its way</span>
                ) : invitation.emailStatus === "failed" ? (
                  <span className="text-xs text-destructive">
                    Email failed: {invitation.emailError ?? "the sender refused it"}
                  </span>
                ) : null}
                {/* No Copy link: only the hash was stored, so the URL existed
                    exactly once, in the dialog that made it. */}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={revoke.isPending}
                  aria-label={`Revoke the invitation for ${invitation.email}`}
                  onClick={() => revoke.mutate({ invitationId: invitation.id })}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : null
      }
    >
      <Button variant="outline" size="sm" onClick={() => setInviting(true)}>
        <Plus aria-hidden />
        Invite someone
      </Button>
      {revoke.error ? <p className="text-sm text-destructive">{revoke.error.message}</p> : null}
      {invitations.isError ? (
        <p className="text-sm text-destructive">
          Could not load the invitations: {invitations.error.message}
        </p>
      ) : null}
      <InviteDialog
        open={inviting}
        onOpenChange={(next) => setInviting(next)}
        onCreated={refresh}
      />
    </SettingsRow>
  );
}

/**
 * Inviting somebody, and the one sight of the link. deevy stores a hash of the
 * token, so this dialog is the only place the URL is shown; when a sender is
 * configured it is also emailed to the address (docs/plans/email-channel.md),
 * and the dialog says whether it was, or why not.
 */
function InviteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<unknown>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState<string | null>(null);

  const create = useMutation(
    orpc.invitations.create.mutationOptions({
      onSuccess: async (created: {
        path: string;
        email: string;
        emailStatus: string | null;
        emailNotSent: string | null;
      }) => {
        setEmailed(
          created.emailStatus
            ? `Emailing the link to ${created.email}.`
            : created.emailNotSent
              ? `Not emailed: ${created.emailNotSent}`
              : null,
        );
        // The link is built on the origin this browser is on, not the API's:
        // they are the same in the image and on Workers, and two ports in the
        // dev loop or a split-origin deployment (docs/plans/sign-in.md). And
        // under the path this deevy lives under (lib/base.ts).
        setLink(appURL(created.path));
        await onCreated();
      },
    }),
  );

  const close = (next: boolean) => {
    if (!next) {
      setEmail("");
      setRole("member");
      setLink(null);
      setEmailed(null);
      create.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            Invite one person by email address. The invitation is good for seven days. deevy emails
            them the link when a sender is set up under Settings › Email, and shows it to you once
            either way.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            {emailed ? <p className="text-sm text-muted-foreground">{emailed}</p> : null}
            <div className="flex min-w-0 flex-col gap-1 rounded-md border border-gate/50 bg-gate/10 p-3">
              <p className="text-sm font-medium">
                Copy this now: it is the only time the link is shown.
              </p>
              {/* Wrapped rather than scrolled: a URL with 43 characters of
                  token in it is wider than the dialog, and half a link is
                  worse than two lines of one. */}
              <code className="rounded bg-background px-2 py-1 font-mono text-sm break-all">
                {link}
              </code>
              <p className="text-xs text-muted-foreground">
                deevy keeps only a hash of it, so it cannot be shown again. Revoke the invitation
                and make another if it goes astray.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(submitted) => {
              submitted.preventDefault();
              if (email.trim()) create.mutate({ email: email.trim(), role });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                autoComplete="off"
                value={email}
                placeholder="grace@example.com"
                onChange={(changed) => setEmail(changed.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(next) => setRole(next as Role)}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue>{(selected: Role) => roleLabels[selected]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="member">{roleLabels.member}</SelectItem>
                    <SelectItem value="admin">{roleLabels.admin}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {create.error ? (
              <p className="text-sm text-destructive">{create.error.message}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !email.trim()}>
                Create invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

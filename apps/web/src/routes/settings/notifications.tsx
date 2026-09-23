import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SettingsPage } from "@/components/settings-page";
import { orpc } from "@/lib/orpc";

/** What each kind of Notification is called on this page, in CONTEXT.md's words. */
const labels: Record<string, string> = {
  mention: "Mention",
  assignment: "Assignment",
  gate_awaiting: "Gate awaiting",
  run_awaiting_input: "Run awaiting input",
  run_finished: "Run finished",
  delegation: "Sub-issues",
};

interface Preference {
  kind: string;
  inbox: boolean;
  slack: boolean;
  slackDm: boolean;
}

/**
 * One Human's own matrix: every kind of Notification against the Channels it
 * can reach them in. Nobody sets anyone else's, so this page needs no Member
 * picker (packages/core/src/operations/preferences.ts).
 */
export function NotificationsPage() {
  const queryClient = useQueryClient();
  const preferences = useQuery(orpc.preferences.get.queryOptions({ input: {} }));
  const [draft, setDraft] = useState<Preference[]>([]);

  useEffect(() => {
    if (preferences.data) setDraft(preferences.data.preferences);
  }, [preferences.data]);

  const save = useMutation(
    orpc.preferences.set.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.preferences.key() }),
    }),
  );

  const toggle = (kind: string, where: "inbox" | "slack" | "slackDm") =>
    setDraft((current) =>
      current.map((row) => (row.kind === kind ? { ...row, [where]: !row[where] } : row)),
    );

  return (
    <SettingsPage title="Notifications">
      {preferences.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}

      {draft.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Notification</TableHead>
              <TableHead className="w-24 text-center">Inbox</TableHead>
              <TableHead className="w-24 text-center">Slack</TableHead>
              <TableHead className="w-28 text-center">Direct message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.map((row) => (
              <TableRow key={row.kind}>
                <TableCell>{labels[row.kind] ?? row.kind}</TableCell>
                <TableCell className="w-24">
                  <div className="flex justify-center">
                    <Checkbox
                      aria-label={`${labels[row.kind] ?? row.kind} in the inbox`}
                      checked={row.inbox}
                      onCheckedChange={() => toggle(row.kind, "inbox")}
                    />
                  </div>
                </TableCell>
                <TableCell className="w-24">
                  <div className="flex justify-center">
                    <Checkbox
                      aria-label={`${labels[row.kind] ?? row.kind} in Slack`}
                      checked={row.slack}
                      onCheckedChange={() => toggle(row.kind, "slack")}
                    />
                  </div>
                </TableCell>
                <TableCell className="w-28">
                  <div className="flex justify-center">
                    <Checkbox
                      aria-label={`${labels[row.kind] ?? row.kind} as a Slack direct message`}
                      checked={row.slackDm}
                      onCheckedChange={() => toggle(row.kind, "slackDm")}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {draft.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Slack is the rooms your admin routes Notifications to. A direct message comes from the
          Slack app once your Slack account is linked, under Identities; until then nothing is sent
          there.
        </p>
      ) : null}

      <div>
        <Button
          disabled={save.isPending || draft.length === 0}
          onClick={() =>
            save.mutate({
              preferences: draft.map((row) => ({
                kind: row.kind as "mention",
                inbox: row.inbox,
                slack: row.slack,
                slackDm: row.slackDm,
              })),
            })
          }
        >
          Save
        </Button>
      </div>
    </SettingsPage>
  );
}

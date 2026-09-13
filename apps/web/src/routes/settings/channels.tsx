import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPage, SettingsSection } from "@/components/settings-page";
import { orpc } from "@/lib/orpc";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The Notification kinds a rule can name, in the words the API uses. */
const kinds = [
  { value: "mention", label: "Mention" },
  { value: "assignment", label: "Assignment" },
  { value: "gate_awaiting", label: "Gate awaiting" },
  { value: "run_awaiting_input", label: "Run awaiting input" },
  { value: "run_finished", label: "Run finished" },
  { value: "delegation", label: "Sub-issues" },
] as const;

type Kind = (typeof kinds)[number]["value"];

interface Rule {
  notificationKind: Kind | null;
  projectId: string | null;
  channelId: string;
}

/** The empty option of a select, which is what "any" is on the wire. */
/** Base UI's Select wants a value for "any"; the empty string is not one. */
const anyValue = "__any";

/**
 * Channels and routing: where Notifications leave deevy for. A Channel is a
 * Slack incoming webhook; a rule says which Notifications go to it.
 */
export function ChannelsPage() {
  const queryClient = useQueryClient();
  const channels = useQuery(orpc.channels.list.queryOptions({ input: {} }));
  const rules = useQuery(orpc.routing.list.queryOptions({ input: {} }));
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));

  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [draft, setDraft] = useState<Rule[]>([]);
  const [tested, setTested] = useState<string | null>(null);

  // The rules a Human edits are a working copy: they are saved as a whole,
  // because a rule only means anything next to the others.
  useEffect(() => {
    if (!rules.data) return;
    setDraft(
      rules.data.rules.map((rule) => ({
        notificationKind: rule.notificationKind as Kind | null,
        projectId: rule.projectId,
        channelId: rule.channelId,
      })),
    );
  }, [rules.data]);

  const refreshChannels = () => queryClient.invalidateQueries({ queryKey: orpc.channels.key() });

  const create = useMutation(
    orpc.channels.create.mutationOptions({
      onSuccess: async () => {
        setName("");
        setWebhookUrl("");
        await refreshChannels();
      },
    }),
  );
  // Removing a Channel drops the routing rules that named it (the server cascades).
  const remove = useMutation(
    orpc.channels.delete.mutationOptions({
      onSuccess: () =>
        Promise.all([
          refreshChannels(),
          queryClient.invalidateQueries({ queryKey: orpc.routing.key() }),
        ]),
    }),
  );
  const test = useMutation(
    orpc.channels.test.mutationOptions({
      onSuccess: (result) =>
        setTested(
          result.delivered
            ? "Slack accepted the message."
            : `Slack refused it: ${result.error ?? result.status}`,
        ),
    }),
  );
  const save = useMutation(
    orpc.routing.set.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.routing.key() }),
    }),
  );

  const rows = channels.data?.channels ?? [];
  const failed = create.error ?? remove.error ?? test.error ?? save.error;

  type ChannelRow = (typeof rows)[number];
  const columns: DataColumn<ChannelRow>[] = [
    {
      id: "name",
      header: "Channel",
      cell: (channel) => <span className="font-medium">{channel.name}</span>,
      sortValue: (channel) => channel.name,
    },
    {
      id: "host",
      header: "Posts to",
      cell: (channel) => <span className="text-muted-foreground">{channel.webhookHost}</span>,
      sortValue: (channel) => channel.webhookHost,
      className: "w-full",
    },
    {
      id: "actions",
      header: "",
      cell: (channel) => (
        <span className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={() => test.mutate({ channelId: channel.id })}
          >
            Test
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ channelId: channel.id })}
          >
            Remove
          </Button>
        </span>
      ),
      className: "text-right",
    },
  ];

  return (
    <SettingsPage title="Channels">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          if (name.trim() && webhookUrl.trim()) {
            create.mutate({ name: name.trim(), webhookUrl: webhookUrl.trim() });
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel-name">Name</Label>
          <Input
            id="channel-name"
            value={name}
            placeholder="#deevy"
            onChange={(changed) => setName(changed.target.value)}
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="channel-webhook">Incoming webhook URL</Label>
          <Input
            id="channel-webhook"
            value={webhookUrl}
            placeholder="https://hooks.slack.com/services/…"
            onChange={(changed) => setWebhookUrl(changed.target.value)}
          />
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim() || !webhookUrl.trim()}>
          Add Channel
        </Button>
      </form>

      {failed ? <p className="text-sm text-destructive">{failed.message}</p> : null}
      {tested ? <p className="text-sm text-muted-foreground">{tested}</p> : null}

      <DataTable
        aria-label="Channels"
        columns={columns}
        rows={rows}
        getRowId={(channel) => channel.id}
        loading={channels.isPending}
        empty={{
          icon: MessageSquare,
          title: "No Channels yet",
          description: "Add a Slack Channel above, then choose which Notifications go to it.",
        }}
      />

      <SettingsSection title="Routing">
        {draft.map((rule, at) => (
          <div key={at} className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rule-kind-${at}`}>Notification</Label>
              <Select
                value={rule.notificationKind ?? anyValue}
                onValueChange={(next) => {
                  if (next === null) return;
                  setDraft((current) =>
                    current.map((one, index) =>
                      index === at
                        ? { ...one, notificationKind: next === anyValue ? null : (next as Kind) }
                        : one,
                    ),
                  );
                }}
              >
                <SelectTrigger id={`rule-kind-${at}`} className="w-48">
                  <SelectValue>
                    {(selected: string) =>
                      selected === anyValue
                        ? "Any"
                        : (kinds.find((kind) => kind.value === selected)?.label ?? selected)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={anyValue}>Any</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    {kinds.map((kind) => (
                      <SelectItem key={kind.value} value={kind.value}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rule-project-${at}`}>Project</Label>
              <Select
                value={rule.projectId ?? anyValue}
                onValueChange={(next) => {
                  if (next === null) return;
                  setDraft((current) =>
                    current.map((one, index) =>
                      index === at ? { ...one, projectId: next === anyValue ? null : next } : one,
                    ),
                  );
                }}
              >
                <SelectTrigger id={`rule-project-${at}`} className="w-32">
                  <SelectValue>
                    {(selected: string) =>
                      selected === anyValue
                        ? "Any"
                        : (projects.data?.projects.find((project) => project.id === selected)
                            ?.key ?? selected)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={anyValue}>Any</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    {(projects.data?.projects ?? []).map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.key}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor={`rule-channel-${at}`}>Channel</Label>
              <Select
                value={rule.channelId}
                onValueChange={(next) => {
                  if (next === null) return;
                  setDraft((current) =>
                    current.map((one, index) => (index === at ? { ...one, channelId: next } : one)),
                  );
                }}
              >
                <SelectTrigger id={`rule-channel-${at}`} className="w-full">
                  <SelectValue>
                    {(selected: string) =>
                      rows.find((channel) => channel.id === selected)?.name ?? selected
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {rows.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        {channel.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDraft((current) => current.filter((_, index) => index !== at))}
            >
              Remove rule
            </Button>
          </div>
        ))}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={() =>
              setDraft((current) => [
                ...current,
                { notificationKind: null, projectId: null, channelId: rows[0]?.id ?? "" },
              ])
            }
          >
            Add rule
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ rules: draft })}>
            Save routing
          </Button>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}

import { Button, Input, SettingsRow } from "@deevy/design-system";
import { Plus, X } from "lucide-react";

/**
 * Settings › General, under the Workspace's name: one setting a row, ruled
 * against one another, the label and its hint on the left, the control on the
 * right once the container is wide enough. They sit in a plain column, not in a
 * SettingsSection.
 */
export const General = () => (
  <div className="@container flex max-w-3xl flex-col">
    <SettingsRow
      label="Who may join"
      hint="Anyone signing in with an address at one of these domains joins your Workspace automatically."
    >
      <div className="flex flex-wrap items-center gap-2 @lg:justify-end">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border pr-1 pl-2.5 font-mono text-xs">
          example.com
          <Button variant="ghost" size="icon-sm" aria-label="Stop allowing example.com">
            <X aria-hidden />
          </Button>
        </span>
        <Button variant="outline" size="sm">
          <Plus aria-hidden />
          Add rule
        </Button>
      </div>
    </SettingsRow>
    <SettingsRow
      label="Invited"
      hint="These people have been invited and haven't joined yet. An invitation works whether or not they match your rules."
      below={
        <ul aria-label="Invitations" className="flex flex-col divide-y rounded-md border bg-card">
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">grace@example.com</span>
            <span className="text-muted-foreground">Member</span>
            <span className="text-xs text-muted-foreground">Expires in 6 days</span>
            <Button
              size="sm"
              variant="destructive"
              aria-label="Revoke the invitation for grace@example.com"
            >
              Revoke
            </Button>
          </li>
        </ul>
      }
    >
      <Button variant="outline" size="sm">
        <Plus aria-hidden />
        Invite someone
      </Button>
    </SettingsRow>
    <SettingsRow
      label="How deep sub-issues may go"
      hint="An Agent opens sub-issues in your tracker. One nested deeper than this isn't handed to any Agent, and the Event log says why."
    >
      <label
        htmlFor="max-depth"
        className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"
      >
        Levels deep
        <Input id="max-depth" type="number" min={1} defaultValue={3} className="w-24" />
      </label>
    </SettingsRow>
  </div>
);

import { Label, Switch } from "@deevy/design-system";

/** On: the track fills in the action colour and the thumb slides right. */
export const On = () => (
  <div className="flex items-center gap-2">
    <Switch id="switch-mention" defaultChecked />
    <Label htmlFor="switch-mention">Route by mention</Label>
  </div>
);

export const Off = () => (
  <div className="flex items-center gap-2">
    <Switch id="switch-mention-off" />
    <Label htmlFor="switch-mention-off">Route by mention</Label>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Switch id="switch-off-disabled" disabled />
      <Label htmlFor="switch-off-disabled">Route by mention</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="switch-on-disabled" disabled defaultChecked />
      <Label htmlFor="switch-on-disabled">Route by mention</Label>
    </div>
  </div>
);

/** `sm` for dense rows; `default` is 28×17. */
export const Sizes = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Switch id="switch-default" size="default" defaultChecked />
      <Label htmlFor="switch-default">Default</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="switch-sm" size="sm" defaultChecked />
      <Label htmlFor="switch-sm" className="text-xs">
        Small
      </Label>
    </div>
  </div>
);

/** A settings row: the Label and its explanation on the left, the Switch on the right. */
export const SettingsRow = () => (
  <div className="flex w-full max-w-sm items-start justify-between gap-4 rounded-md border bg-card p-3">
    <div className="flex flex-col gap-0.5">
      <Label htmlFor="switch-row">Route by mention</Label>
      <p className="text-xs text-muted-foreground">
        A comment such as <span className="font-mono">@deevy planner</span> hands the record to that
        Agent.
      </p>
    </div>
    <Switch id="switch-row" defaultChecked />
  </div>
);

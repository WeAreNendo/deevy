import { Label, Switch } from "@deevy/design-system";

/** On: the track fills in the action colour and the thumb slides right. */
export const On = () => (
  <label className="flex h-8 items-center gap-3 text-sm">
    <Switch defaultChecked />
    Route by mention
  </label>
);

export const Off = () => (
  <label className="flex h-8 items-center gap-3 text-sm">
    <Switch />
    Route by mention
  </label>
);

export const Disabled = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Switch id="switch-off-disabled" disabled />
      <Label htmlFor="switch-off-disabled">Off</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="switch-on-disabled" disabled defaultChecked />
      <Label htmlFor="switch-on-disabled">On</Label>
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

/** The one switch deevy has, in a Project's binding: named by the label around it, what it does under it. */
export const RouteByMention = () => (
  <div className="flex max-w-sm flex-col gap-1.5">
    <label className="flex h-8 items-center gap-3 text-sm">
      <Switch defaultChecked />
      Route by mention
    </label>
    <span className="text-xs text-muted-foreground">
      A comment such as <code className="font-mono">@deevy planner</code> hands the record to that
      Agent. Off, a comment hands it to nobody: a label, an assignment in the tool or the Default
      Agent still does.
    </span>
  </div>
);

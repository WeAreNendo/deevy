import { Checkbox, Input, Label } from "@deevy/design-system";

/** 14px medium, tight leading; `htmlFor` ties it to the control below. */
export const Default = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="label-name">Name</Label>
    <Input id="label-name" placeholder="Planner" />
  </div>
);

/** A hint goes under the control, in 12px muted. */
export const WithHint = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="label-webhook">Webhook URL</Label>
    <Input id="label-webhook" inputMode="url" placeholder="https://agent.example.com/" />
    <p className="text-xs text-muted-foreground">It must be https.</p>
  </div>
);

/** Around a Checkbox the Label is the click target for the box. */
export const Inline = () => (
  <Label className="flex items-center gap-2 font-normal">
    <Checkbox defaultChecked />
    Not the Human the work is for
  </Label>
);

/** Inside a `group` marked `data-disabled`, the Label dims to half and stops taking clicks. */
export const Disabled = () => (
  <div className="group flex items-center gap-2" data-disabled="true">
    <Checkbox id="label-disabled" disabled />
    <Label htmlFor="label-disabled" className="font-normal">
      Not the Human the work is for
    </Label>
  </div>
);

import { Checkbox, Input, Label } from "@deevy/design-system";

/** 14px medium, tight leading; `htmlFor` ties it to the control below. */
export const Default = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="label-name">Name</Label>
    <Input id="label-name" defaultValue="Planner" />
  </div>
);

/** A required mark, and a hint in the same row pushed to the end. */
export const WithHint = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="label-handle">
      Handle
      <span className="text-destructive" aria-hidden>
        *
      </span>
      <span className="ml-auto text-xs font-normal text-muted-foreground">
        lowercase, digits, dashes
      </span>
    </Label>
    <Input id="label-handle" placeholder="planner" className="font-mono" />
  </div>
);

/** Beside a Checkbox the Label is the click target for the box. */
export const Inline = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="label-exclude" defaultChecked />
    <Label htmlFor="label-exclude">Not the Human the work is for</Label>
  </div>
);

/** Inside a `group` marked `data-disabled`, the Label dims to half and stops taking clicks. */
export const Disabled = () => (
  <div className="group flex items-center gap-2" data-disabled="true">
    <Checkbox id="label-disabled" disabled />
    <Label htmlFor="label-disabled">Its code is here too, so its Agents push to it</Label>
  </div>
);

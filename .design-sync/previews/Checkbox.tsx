import { Checkbox, Label } from "@deevy/design-system";

/** 16px box beside a Label; a Checkpoint's "Not the Human the work is for". */
export const WithLabel = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="checkbox-exclude" />
    <Label htmlFor="checkbox-exclude">Not the Human the work is for</Label>
  </div>
);

/** Checked fills in the action colour with a white check. */
export const Checked = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="checkbox-code" defaultChecked />
    <Label htmlFor="checkbox-code">Its code is here too, so its Agents push to it</Label>
  </div>
);

/** A disabled box dims its Label through the row's `data-disabled`. */
export const Disabled = () => (
  <div className="flex flex-col gap-3">
    <div className="group flex items-center gap-2" data-disabled="true">
      <Checkbox id="checkbox-off" disabled />
      <Label htmlFor="checkbox-off">Omar Haddad</Label>
    </div>
    <div className="group flex items-center gap-2" data-disabled="true">
      <Checkbox id="checkbox-on" disabled defaultChecked />
      <Label htmlFor="checkbox-on">Ada Lovelace</Label>
    </div>
  </div>
);

/** A column of choices, as a Checkpoint names who may rule on it. */
export const Group = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-ada" defaultChecked />
      <Label htmlFor="checkbox-ada">Ada Lovelace</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-grace" defaultChecked />
      <Label htmlFor="checkbox-grace">Grace Hopper</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-omar" />
      <Label htmlFor="checkbox-omar">Omar Haddad</Label>
    </div>
  </div>
);

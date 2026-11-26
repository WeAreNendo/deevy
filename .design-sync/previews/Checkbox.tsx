import { Checkbox, Label } from "@deevy/design-system";

/** A 16px box inside its Label, as a Checkpoint's policy has it. */
export const WithLabel = () => (
  <Label className="flex items-center gap-2 font-normal">
    <Checkbox />
    Not the Human the work is for
  </Label>
);

/** Checked fills in the action colour with a white check. */
export const Checked = () => (
  <Label className="flex items-center gap-2 font-normal">
    <Checkbox defaultChecked />
    Not the Human the work is for
  </Label>
);

/** A disabled box dims its Label through the row's `data-disabled`. */
export const Disabled = () => (
  <div className="flex flex-col gap-3">
    <div className="group flex items-center gap-2" data-disabled="true">
      <Checkbox id="checkbox-off" disabled />
      <Label htmlFor="checkbox-off" className="font-normal">
        Omar Haddad
      </Label>
    </div>
    <div className="group flex items-center gap-2" data-disabled="true">
      <Checkbox id="checkbox-on" disabled defaultChecked />
      <Label htmlFor="checkbox-on" className="font-normal">
        Ada Lovelace
      </Label>
    </div>
  </div>
);

/** Who may rule at a Checkpoint: each Human a bordered Label, wrapping. */
export const WhoMayRule = () => (
  <fieldset className="flex max-w-md flex-col gap-1.5">
    <legend className="text-xs text-muted-foreground">
      Who may rule. None named means every active Human.
    </legend>
    <div className="flex flex-wrap gap-2">
      {["Ada Lovelace", "Grace Hopper", "Omar Haddad"].map((name) => (
        <Label
          key={name}
          className="flex items-center gap-2 rounded-md border px-2 py-1 font-normal"
        >
          <Checkbox defaultChecked={name !== "Omar Haddad"} />
          {name}
        </Label>
      ))}
    </div>
  </fieldset>
);

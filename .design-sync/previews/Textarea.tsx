import { Label, Textarea } from "@deevy/design-system";

/** A Gate's Note, the one thing a Human writes in deevy about work. It is plain text. */
export const Default = () => (
  <div className="flex w-full max-w-sm flex-col gap-1.5">
    <Label htmlFor="textarea-note">Note</Label>
    <Textarea
      id="textarea-note"
      rows={2}
      placeholder="Why, in a sentence. Optional on an approval."
    />
  </div>
);

export const WithValue = () => (
  <div className="flex w-full max-w-sm flex-col gap-1.5">
    <Label htmlFor="textarea-value">Note</Label>
    <Textarea
      id="textarea-value"
      rows={2}
      defaultValue="Keep the old offset working for one release, and say so in the changelog."
    />
  </div>
);

/** `field-sizing: content`: the box is 64px empty and grows with the text; `rows` is only a fallback. A Project's description. */
export const GrowsWithContent = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="textarea-description">Description</Label>
    <Textarea
      id="textarea-description"
      rows={3}
      placeholder="What this Project is for."
      defaultValue={
        "The glue between a team's tools and its Agents.\n\nIts records are issues on GitHub, labelled for the Agent that works them.\n\nAsk Ada Lovelace before a record changes what an operation is called."
      }
    />
  </div>
);

/** Muted while it takes nothing, with the reason under it: a Gate this Human has ruled on. */
export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="textarea-ruled">Note</Label>
      <Textarea
        id="textarea-ruled"
        rows={2}
        disabled
        placeholder="Why, in a sentence. Optional on an approval."
      />
    </div>
    <p className="text-sm text-muted-foreground">You have already ruled on this Gate</p>
  </div>
);

/** `aria-invalid` paints the border and a soft ring. No screen refuses what is typed in one. */
export const Invalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="textarea-invalid">Text</Label>
    <Textarea id="textarea-invalid" rows={3} aria-invalid defaultValue="A value" />
    <p className="text-xs text-destructive">What is wrong with it</p>
  </div>
);

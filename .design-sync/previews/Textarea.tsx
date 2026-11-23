import { Label, Textarea } from "@deevy/design-system";

/** Three rows, resize off; a Ruling's Note, the one thing a Human writes in deevy about work. */
export const Default = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="textarea-description">Note</Label>
    <Textarea
      id="textarea-description"
      rows={3}
      placeholder="What the Agent should know. Markdown."
    />
  </div>
);

export const WithValue = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="textarea-body">Note</Label>
    <Textarea
      id="textarea-body"
      rows={4}
      defaultValue={
        "Approved. Keep `offset` working for one release, and say so in the changeset.\n\nBuilder can take it from here."
      }
    />
  </div>
);

/** `field-sizing: content`: the box is 64px empty and grows with the text; `rows` is only a fallback. */
export const GrowsWithContent = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <Textarea rows={2} defaultValue="Approved. Ship it." aria-label="Short Note" />
    <Textarea
      rows={2}
      aria-label="Long Note"
      defaultValue={
        "Rejected. The Work list sorts by Changed, not `seq`, so a cursor on `seq` pages it out of order.\n\nPage it by `(changed, id)` instead, and say what happens to a row that changes between pages.\n\nAsk at plan again once that is in."
      }
    />
  </div>
);

export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="textarea-archived">App manifest</Label>
    <Textarea
      id="textarea-archived"
      rows={3}
      disabled
      className="font-mono text-xs"
      defaultValue={
        '{\n  "name": "deevy for acme",\n  "url": "https://deevy.example.com",\n  "hook_attributes": { "url": "https://deevy.example.com/hooks/sock_4k9m2q7x1z3c" }\n}'
      }
    />
  </div>
);

export const Invalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="textarea-note">Note</Label>
    <Textarea id="textarea-note" rows={3} aria-invalid placeholder="Why, in a sentence." />
    <p className="text-xs text-destructive">A rejection needs a reason the Agent can act on.</p>
  </div>
);

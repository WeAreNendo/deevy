import { Input, Label } from "@deevy/design-system";

/** 32px tall, 14px text, on the card surface. A new Agent's name is the first thing deevy asks. */
export const Default = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-agent-name">Name</Label>
    <Input id="input-agent-name" placeholder="Planner" />
  </div>
);

export const WithValue = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-routing">Routing label</Label>
    <Input id="input-routing" defaultValue="agent:" placeholder="agent:" className="font-mono" />
  </div>
);

/** Muted surface at half opacity; the cursor says not-allowed. */
export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-container">Container</Label>
    <Input id="input-container" defaultValue="acme/deevy" disabled className="font-mono" />
  </div>
);

/** `aria-invalid` paints the border and a soft ring in destructive; the message sits below. */
export const Invalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-name">Name</Label>
    <Input id="input-name" defaultValue="" aria-invalid placeholder="deevy" />
    <p className="text-xs text-destructive">A Project needs a name.</p>
  </div>
);

/** A plain search box; the Work list looks for a key or a word of a title. */
export const Search = () => (
  <div className="w-full max-w-sm">
    <Input type="search" aria-label="Search Work" placeholder="A key or a word of the title…" />
  </div>
);

/** Types the browser draws differently still get the same frame. */
export const Types = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <Input type="email" placeholder="grace@example.com" aria-label="Email" />
    <Input type="url" defaultValue="https://agent.example.com/" aria-label="Webhook URL" />
    <Input type="number" defaultValue={2} min={1} aria-label="Approvals" className="w-24" />
  </div>
);

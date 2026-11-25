import { Input, Label } from "@deevy/design-system";

/** 32px tall, 14px text, on the card surface. A new Agent's name. */
export const Default = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-agent-name">Name</Label>
    <Input id="input-agent-name" placeholder="Planner" />
  </div>
);

/** With the line under it that says what the value does: a Project's routing label. */
export const WithValue = () => (
  <div className="flex w-full max-w-sm flex-col gap-1.5">
    <Label htmlFor="input-routing">Routing label</Label>
    <Input id="input-routing" className="w-44" defaultValue="agent:" placeholder="agent:" />
    <span className="text-xs text-muted-foreground">
      A record labelled <code className="font-mono">agent:planner</code> goes to that Agent.
    </span>
  </div>
);

/** Muted surface at half opacity; the cursor says not-allowed. Connecting Linear, once its addresses are shown. */
export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-disabled">Name</Label>
    <Input id="input-disabled" defaultValue="Acme on Linear" disabled />
  </div>
);

/** `aria-invalid` paints the border and a soft ring in destructive; the message sits below. */
export const Invalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-name">Name</Label>
    <Input id="input-name" defaultValue="" aria-invalid />
    <p className="text-xs text-destructive">A Project needs a name</p>
  </div>
);

/** Work's search: a plain field in the filter bar, its label for screen readers. */
export const Search = () => (
  <div>
    <Label htmlFor="work-search" className="sr-only">
      Search
    </Label>
    <Input id="work-search" placeholder="A key or a word of the title…" className="w-56" />
  </div>
);

/** Types the browser draws differently still get the same frame. */
export const Types = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <Input type="email" placeholder="grace@example.com" aria-label="Email" />
    <Input inputMode="url" placeholder="https://agent.example.com/" aria-label="Webhook URL" />
    <Input type="number" defaultValue={2} min={1} aria-label="Approvals" className="w-20" />
  </div>
);

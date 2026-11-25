import { Button } from "@deevy/design-system";
import { ArrowRight, Plus, Trash2, X } from "lucide-react";

/** The six looks. `default` is the one action colour; `destructive` is for what does not undo. No screen uses `secondary` or `link`. */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Bind a Project</Button>
    <Button variant="outline">Reinstate</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Revoke</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="link">Link</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="xs">Extra small</Button>
    <Button size="sm">Small</Button>
    <Button>Default</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline">
      <Plus data-icon="inline-start" /> Add a Checkpoint
    </Button>
    <Button size="sm" variant="outline">
      <Plus data-icon="inline-start" /> Invite someone
    </Button>
    <Button variant="outline">
      Next <ArrowRight data-icon="inline-end" />
    </Button>
  </div>
);

/** The action is the label, so it takes an `aria-label`. */
export const IconOnly = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="icon-xs" variant="ghost" aria-label="Close">
      <X />
    </Button>
    <Button size="icon-sm" variant="ghost" aria-label="Stop allowing example.com">
      <X />
    </Button>
    <Button size="icon" variant="outline" aria-label="Add">
      <Plus />
    </Button>
    <Button size="icon-lg" variant="destructive" aria-label="Remove ship">
      <Trash2 />
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled>Bind it</Button>
    <Button variant="outline" disabled>
      Reinstate
    </Button>
    <Button variant="destructive" disabled>
      Revoke
    </Button>
  </div>
);

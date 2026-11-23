import { Button } from "@deevy/design-system";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";

/** The six looks. `default` is the one action colour; `destructive` is for what does not undo. */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Bind a Project</Button>
    <Button variant="secondary">Generate</Button>
    <Button variant="outline">Reinstate</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Revoke key</Button>
    <Button variant="link">All Runs</Button>
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
    <Button>
      <Plus data-icon="inline-start" /> Bind a Project
    </Button>
    <Button variant="outline">
      Continue <ArrowRight data-icon="inline-end" />
    </Button>
    <Button variant="secondary">
      <Check data-icon="inline-start" /> Approve
    </Button>
  </div>
);

export const IconOnly = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="icon-xs" variant="ghost" aria-label="Add a Checkpoint">
      <Plus />
    </Button>
    <Button size="icon-sm" variant="outline" aria-label="Add rule">
      <Plus />
    </Button>
    <Button size="icon" variant="outline" aria-label="Invite someone">
      <Plus />
    </Button>
    <Button size="icon-lg" variant="destructive" aria-label="Remove ship">
      <Trash2 />
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled>Bind a Project</Button>
    <Button variant="outline" disabled>
      Reinstate
    </Button>
    <Button variant="destructive" disabled>
      Revoke key
    </Button>
  </div>
);

import { DeevyMark } from "@deevy/design-system";

/** The mark alone: a Human's indigo half and an Agent's rose bar. Decoration; whatever holds it says "deevy". */
export const Sizes = () => (
  <div className="flex items-end gap-6">
    <DeevyMark className="h-12" />
    <DeevyMark className="h-8" />
    <DeevyMark />
    <DeevyMark className="h-4" />
  </div>
);

/** Where a square is wanted: an app tile on the card, the sidebar's ground. */
export const OnGrounds = () => (
  <div className="flex items-center gap-4">
    <span className="flex size-12 items-center justify-center rounded-lg border bg-card">
      <DeevyMark className="h-7" />
    </span>
    <span className="flex size-12 items-center justify-center rounded-lg border bg-sidebar">
      <DeevyMark className="h-7" />
    </span>
    <span className="flex size-12 items-center justify-center rounded-lg border bg-muted">
      <DeevyMark className="h-7" />
    </span>
  </div>
);

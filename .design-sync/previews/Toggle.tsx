import { Toggle } from "@deevy/design-system";
import { Eye, Pin } from "lucide-react";

// No screen uses a Toggle on its own: the filters that toggle are a
// ToggleGroup, and the Runs feed's Mine is a Button. The words are of no product.

/** Pressed, it tints with the action colour; unpressed it is quiet. */
export const PressedAndNot = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle defaultPressed>
      <Eye data-icon="inline-start" /> Details
    </Toggle>
    <Toggle>
      <Eye data-icon="inline-start" /> Details
    </Toggle>
  </div>
);

/** Outline: on, the border tints with the fill. */
export const Outline = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle variant="outline" defaultPressed>
      <Pin data-icon="inline-start" /> Pinned
    </Toggle>
    <Toggle variant="outline">
      <Pin data-icon="inline-start" /> Pinned
    </Toggle>
  </div>
);

/** The same heights as Button, so a toggle beside one lines up. */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle variant="outline" size="sm" defaultPressed>
      <Pin data-icon="inline-start" /> Small
    </Toggle>
    <Toggle variant="outline" defaultPressed>
      <Pin data-icon="inline-start" /> Default
    </Toggle>
    <Toggle variant="outline" size="lg" defaultPressed>
      <Pin data-icon="inline-start" /> Large
    </Toggle>
  </div>
);

/** Icon only, and disabled. */
export const IconOnlyAndDisabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle variant="outline" aria-label="Pinned" defaultPressed>
      <Pin />
    </Toggle>
    <Toggle variant="outline" aria-label="Pinned">
      <Pin />
    </Toggle>
    <Toggle variant="outline" disabled>
      <Pin data-icon="inline-start" /> Pinned
    </Toggle>
  </div>
);

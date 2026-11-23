import { runStatusLabels, Toggle } from "@deevy/design-system";
import { Activity, Bot, Check, Hourglass } from "lucide-react";

/** Pressed, it tints with the action colour; unpressed it is quiet. The Runs feed's filters. */
export const PressedAndNot = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle defaultPressed>
      <Hourglass data-icon="inline-start" /> {runStatusLabels.awaiting_input}
    </Toggle>
    <Toggle>
      <Activity data-icon="inline-start" /> {runStatusLabels.active}
    </Toggle>
  </div>
);

/** Outline: on, the border tints with the fill. */
export const Outline = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle variant="outline" aria-label="Only Runs of my Agents" defaultPressed>
      <Bot data-icon="inline-start" /> Mine
    </Toggle>
    <Toggle variant="outline" aria-label="Only Runs of my Agents">
      <Bot data-icon="inline-start" /> Mine
    </Toggle>
  </div>
);

/** The same heights as Button, so a toggle beside one lines up. */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle variant="outline" size="sm" aria-label="Finished" defaultPressed>
      <Check data-icon="inline-start" /> Small
    </Toggle>
    <Toggle variant="outline" aria-label="Finished" defaultPressed>
      <Check data-icon="inline-start" /> Default
    </Toggle>
    <Toggle variant="outline" size="lg" aria-label="Finished" defaultPressed>
      <Check data-icon="inline-start" /> Large
    </Toggle>
  </div>
);

/** Icon only, and disabled. */
export const IconOnlyAndDisabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Toggle variant="outline" aria-label="Finished" defaultPressed>
      <Check />
    </Toggle>
    <Toggle variant="outline" aria-label="Finished">
      <Check />
    </Toggle>
    <Toggle variant="outline" aria-label="Finished" disabled>
      <Check data-icon="inline-start" /> Finished
    </Toggle>
  </div>
);

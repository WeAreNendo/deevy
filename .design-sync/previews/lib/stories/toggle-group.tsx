import { runStatusLabels, ToggleGroup, ToggleGroupItem } from "@deevy/design-system";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";

const statuses = ["active", "awaiting_input", "completed"] as const;

/** The Runs feed's statuses, in the kit's own words: joined, one pressed or none. */
export const RunStatuses = () => (
  <ToggleGroup defaultValue={["awaiting_input"]} variant="outline" spacing={0}>
    {statuses.map((status) => (
      <ToggleGroupItem key={status} value={status}>
        {runStatusLabels[status]}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

/** Work's: open records or closed ones; neither pressed is both. */
export const OpenOrClosed = () => (
  <ToggleGroup defaultValue={["open"]} variant="outline" spacing={0}>
    <ToggleGroupItem value="open">Open</ToggleGroupItem>
    <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
  </ToggleGroup>
);

// No screen has the ones below, so their words are of no product.

/** Icon only. */
export const IconOnly = () => (
  <ToggleGroup defaultValue={["left"]} aria-label="Align" variant="outline" spacing={0}>
    <ToggleGroupItem value="left" aria-label="Left">
      <AlignLeft />
    </ToggleGroupItem>
    <ToggleGroupItem value="center" aria-label="Centre">
      <AlignCenter />
    </ToggleGroupItem>
    <ToggleGroupItem value="right" aria-label="Right">
      <AlignRight />
    </ToggleGroupItem>
  </ToggleGroup>
);

/** Small. */
export const Small = () => (
  <ToggleGroup defaultValue={["one"]} aria-label="Pick one" variant="outline" size="sm" spacing={0}>
    <ToggleGroupItem value="one">One</ToggleGroupItem>
    <ToggleGroupItem value="two">Two</ToggleGroupItem>
  </ToggleGroup>
);

/** Spaced and borderless, the default: for a set that is not one control. */
export const Spaced = () => (
  <ToggleGroup defaultValue={["one"]} aria-label="Show">
    <ToggleGroupItem value="one">One</ToggleGroupItem>
    <ToggleGroupItem value="two">Two</ToggleGroupItem>
    <ToggleGroupItem value="three">Three</ToggleGroupItem>
  </ToggleGroup>
);

export const Disabled = () => (
  <ToggleGroup defaultValue={["one"]} aria-label="Pick one" variant="outline" spacing={0} disabled>
    <ToggleGroupItem value="one">One</ToggleGroupItem>
    <ToggleGroupItem value="two">Two</ToggleGroupItem>
  </ToggleGroup>
);

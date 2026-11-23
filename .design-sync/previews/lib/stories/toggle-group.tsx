import { runStatusLabels, ToggleGroup, ToggleGroupItem } from "@deevy/design-system";
import { Bot, Monitor, Moon, Sun, User } from "lucide-react";

/** Work's filter bar as joined toggles: who a record is routed to, one of three pressed. */
export const RoutedTo = () => (
  <ToggleGroup defaultValue={["agent"]} aria-label="Routed to" variant="outline" spacing={0}>
    <ToggleGroupItem value="any" aria-label="Anybody">
      Anybody
    </ToggleGroupItem>
    <ToggleGroupItem value="human" aria-label="A Human">
      <User />
      A Human
    </ToggleGroupItem>
    <ToggleGroupItem value="agent" aria-label="An Agent">
      <Bot />
      An Agent
    </ToggleGroupItem>
  </ToggleGroup>
);

/** Open records, or every record. */
export const OpenOrAll = () => (
  <ToggleGroup defaultValue={["open"]} aria-label="Open or closed" variant="outline" spacing={0}>
    <ToggleGroupItem value="open">Open</ToggleGroupItem>
    <ToggleGroupItem value="all">All</ToggleGroupItem>
  </ToggleGroup>
);

/** Icon only: the theme, as System, Light or Dark. */
export const Theme = () => (
  <ToggleGroup defaultValue={["system"]} aria-label="Theme" variant="outline" spacing={0}>
    <ToggleGroupItem value="system" aria-label="System">
      <Monitor />
    </ToggleGroupItem>
    <ToggleGroupItem value="light" aria-label="Light">
      <Sun />
    </ToggleGroupItem>
    <ToggleGroupItem value="dark" aria-label="Dark">
      <Moon />
    </ToggleGroupItem>
  </ToggleGroup>
);

/** Small, in a page header: the Runs feed's statuses, in the kit's own words. */
export const Small = () => (
  <ToggleGroup
    defaultValue={["awaiting_input"]}
    aria-label="Runs"
    variant="outline"
    size="sm"
    spacing={0}
  >
    {(["active", "awaiting_input", "completed"] as const).map((status) => (
      <ToggleGroupItem key={status} value={status}>
        {runStatusLabels[status]}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

/** Spaced and borderless, the default: for a set that is not one control — the Event log's families. */
export const Spaced = () => (
  <ToggleGroup defaultValue={["runs"]} aria-label="Show">
    <ToggleGroupItem value="records">Records</ToggleGroupItem>
    <ToggleGroupItem value="runs">Runs and Gates</ToggleGroupItem>
    <ToggleGroupItem value="workspace">Workspace</ToggleGroupItem>
  </ToggleGroup>
);

/** Nothing to choose while the list loads. */
export const Disabled = () => (
  <ToggleGroup
    defaultValue={["open"]}
    aria-label="Open or closed"
    variant="outline"
    spacing={0}
    disabled
  >
    <ToggleGroupItem value="open">Open</ToggleGroupItem>
    <ToggleGroupItem value="all">All</ToggleGroupItem>
  </ToggleGroup>
);

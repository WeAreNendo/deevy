import { Button, ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@deevy/design-system";
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

// No screen uses a ButtonGroup. A Gate's Approve and Reject are two separate
// Buttons, never joined and never one behind the other. The words are of no product.

/** Two actions on one thing, joined. */
export const Joined = () => (
  <ButtonGroup aria-label="Move">
    <Button variant="outline">Back</Button>
    <Button variant="outline">Forward</Button>
  </ButtonGroup>
);

/** Icons, one of them with nowhere to go. */
export const Icons = () => (
  <ButtonGroup aria-label="Move">
    <Button variant="outline" size="icon" aria-label="Back" disabled>
      <ChevronLeft />
    </Button>
    <Button variant="outline" size="icon" aria-label="Forward">
      <ChevronRight />
    </Button>
  </ButtonGroup>
);

/** Text inside the group, joined to the buttons it describes. */
export const WithText = () => (
  <ButtonGroup aria-label="Amount">
    <ButtonGroupText className="tabular-nums">2 of 3</ButtonGroupText>
    <Button variant="outline" size="icon" aria-label="Less">
      <Minus />
    </Button>
    <Button variant="outline" size="icon" aria-label="More">
      <Plus />
    </Button>
  </ButtonGroup>
);

/** A filled pair, with a separator between because neither has a border. */
export const WithSeparator = () => (
  <ButtonGroup aria-label="Save">
    <Button>Save</Button>
    <ButtonGroupSeparator />
    <Button size="icon-lg" aria-label="Other ways to save">
      <ChevronDown />
    </Button>
  </ButtonGroup>
);

/** Stacked, where the row has no room. */
export const Vertical = () => (
  <ButtonGroup orientation="vertical" aria-label="Amount">
    <Button variant="outline" size="icon" aria-label="More">
      <Plus />
    </Button>
    <Button variant="outline" size="icon" aria-label="Less">
      <Minus />
    </Button>
  </ButtonGroup>
);

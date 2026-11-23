import {
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@deevy/design-system";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";

/** Two actions on one thing, joined: a Project's Checkpoints, Move up / Move down for one of them. */
export const Reorder = () => (
  <div className="flex w-80 items-center gap-2 rounded-md border bg-card px-3 py-2">
    <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
      ship
    </Badge>
    <span className="text-xs tabular-nums text-muted-foreground">2 approvals</span>
    <span className="flex-1" />
    <ButtonGroup aria-label="Reorder ship">
      <Button variant="outline" size="icon" aria-label="Move ship up">
        <ArrowUp />
      </Button>
      <Button variant="outline" size="icon" aria-label="Move ship down">
        <ArrowDown />
      </Button>
    </ButtonGroup>
  </div>
);

/** The first Checkpoint cannot move up; the last cannot move down. */
export const AtTheEnds = () => (
  <div className="flex flex-wrap items-center gap-6">
    <ButtonGroup aria-label="Reorder plan">
      <Button variant="outline" size="icon" aria-label="Move plan up" disabled>
        <ArrowUp />
      </Button>
      <Button variant="outline" size="icon" aria-label="Move plan down">
        <ArrowDown />
      </Button>
    </ButtonGroup>
    <ButtonGroup aria-label="Reorder ship">
      <Button variant="outline" size="icon" aria-label="Move ship up">
        <ArrowUp />
      </Button>
      <Button variant="outline" size="icon" aria-label="Move ship down" disabled>
        <ArrowDown />
      </Button>
    </ButtonGroup>
  </div>
);

/** Text inside the group, joined to the buttons it describes. */
export const WithText = () => (
  <ButtonGroup aria-label="Checkpoint">
    <ButtonGroupText className="tabular-nums">Checkpoint 2 of 3</ButtonGroupText>
    <Button variant="outline" size="icon" aria-label="Move up">
      <ArrowUp />
    </Button>
    <Button variant="outline" size="icon" aria-label="Move down">
      <ArrowDown />
    </Button>
  </ButtonGroup>
);

/** A split button: Approve, and the other Ruling behind a separator. */
export const WithSeparator = () => (
  <ButtonGroup aria-label="Rule on the Gate">
    <Button>Approve</Button>
    <ButtonGroupSeparator />
    <Button size="icon" aria-label="Reject instead">
      <ChevronDown />
    </Button>
  </ButtonGroup>
);

/** Stacked, where the row has no room. */
export const Vertical = () => (
  <ButtonGroup orientation="vertical" aria-label="Reorder ship">
    <Button variant="outline" size="icon" aria-label="Move ship up">
      <ArrowUp />
    </Button>
    <Button variant="outline" size="icon" aria-label="Move ship down">
      <ArrowDown />
    </Button>
  </ButtonGroup>
);

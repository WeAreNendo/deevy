import { Button, ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@deevy/design-system";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

/** Two actions on one thing, joined: the page before and the page after. */
export const Pager = () => (
  <div className="flex w-80 items-center gap-2 rounded-md border bg-card px-3 py-2">
    <span className="text-xs tabular-nums text-muted-foreground">Runs 101–200</span>
    <span className="flex-1" />
    <ButtonGroup aria-label="Pages of Runs">
      <Button variant="outline" size="icon" aria-label="Newer Runs">
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon" aria-label="Older Runs">
        <ChevronRight />
      </Button>
    </ButtonGroup>
  </div>
);

/** Nothing is newer than the first page, nor older than the last. */
export const AtTheEnds = () => (
  <div className="flex flex-wrap items-center gap-6">
    <ButtonGroup aria-label="First page">
      <Button variant="outline" size="icon" aria-label="Newer Runs" disabled>
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon" aria-label="Older Runs">
        <ChevronRight />
      </Button>
    </ButtonGroup>
    <ButtonGroup aria-label="Last page">
      <Button variant="outline" size="icon" aria-label="Newer Runs">
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon" aria-label="Older Runs" disabled>
        <ChevronRight />
      </Button>
    </ButtonGroup>
  </div>
);

/** Text inside the group, joined to the buttons it describes. */
export const WithText = () => (
  <ButtonGroup aria-label="Pages of Runs">
    <ButtonGroupText className="tabular-nums">Page 2 of 3</ButtonGroupText>
    <Button variant="outline" size="icon" aria-label="Newer Runs">
      <ChevronLeft />
    </Button>
    <Button variant="outline" size="icon" aria-label="Older Runs">
      <ChevronRight />
    </Button>
  </ButtonGroup>
);

/** A split button: Approve, and the other Ruling behind a separator. */
export const WithSeparator = () => (
  <ButtonGroup aria-label="Rule on the Gate">
    <Button>Approve</Button>
    <ButtonGroupSeparator />
    <Button size="icon-lg" aria-label="Reject instead">
      <ChevronDown />
    </Button>
  </ButtonGroup>
);

/** Stacked, where the row has no room. */
export const Vertical = () => (
  <ButtonGroup orientation="vertical" aria-label="Pages of Runs">
    <Button variant="outline" size="icon" aria-label="Newer Runs">
      <ChevronUp />
    </Button>
    <Button variant="outline" size="icon" aria-label="Older Runs">
      <ChevronDown />
    </Button>
  </ButtonGroup>
);

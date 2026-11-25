import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@deevy/design-system";
import { Cable, FolderKanban, SearchX } from "lucide-react";

/** The words say what emptied the list, and the action undoes it: the Event log under its filters. */
export const NoMatch = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SearchX aria-hidden />
      </EmptyMedia>
      <EmptyTitle>No Events match your filters</EmptyTitle>
      <EmptyDescription>Try adjusting or clearing your filters.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button variant="outline" size="sm">
        Clear filters
      </Button>
    </EmptyContent>
  </Empty>
);

/** Needs me with nothing on it: no icon, because nothing is missing. */
export const NothingNeedsYou = () => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>Nothing needs you</EmptyTitle>
      <EmptyDescription>
        Gates awaiting your ruling and your Agents&apos; Runs will show up here.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const NoTools = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Cable aria-hidden />
      </EmptyMedia>
      <EmptyTitle>No tools connected yet</EmptyTitle>
      <EmptyDescription>
        deevy works in the tools your team already uses. Connect one, and bind a Project to a
        container inside it.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const NoProjects = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FolderKanban aria-hidden />
      </EmptyMedia>
      <EmptyTitle>No Projects yet</EmptyTitle>
      <EmptyDescription>
        A Project binds a container in one of your tools to the Agents that work it. Connect a tool
        under Sockets, then bind one of its containers here.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

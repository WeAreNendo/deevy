import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@deevy/design-system";
import { Activity, ClipboardList, FolderOpen, SearchX } from "lucide-react";

/** The words say what emptied the list, and the action undoes it. */
export const NoMatch = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SearchX aria-hidden />
      </EmptyMedia>
      <EmptyTitle>Nothing matches your filters</EmptyTitle>
      <EmptyDescription>Clear a filter to see the rest.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button variant="outline" size="sm">
        Clear filters
      </Button>
    </EmptyContent>
  </Empty>
);

export const NothingNeedsYou = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ClipboardList aria-hidden />
      </EmptyMedia>
      <EmptyTitle>Nothing needs you</EmptyTitle>
      <EmptyDescription>
        Gates awaiting your ruling and your Agents&apos; Runs will show up here.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const NoProjects = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FolderOpen aria-hidden />
      </EmptyMedia>
      <EmptyTitle>No Projects yet</EmptyTitle>
      <EmptyDescription>
        A Project binds a container in one of your tools to the Agents that work it.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button size="sm">Bind a Project</Button>
    </EmptyContent>
  </Empty>
);

/** The Runs feed under Mine, with the way back to every Agent's Runs. */
export const NoneOfMine = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Activity aria-hidden />
      </EmptyMedia>
      <EmptyTitle>No Runs match your filters</EmptyTitle>
      <EmptyDescription>
        Mine shows the Runs of the Agents you sponsor. Turn it off to see everyone&apos;s.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button variant="outline" size="sm">
        Show all Runs
      </Button>
    </EmptyContent>
  </Empty>
);

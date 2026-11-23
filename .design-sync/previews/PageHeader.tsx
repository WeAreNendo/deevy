import {
  Button,
  PageHeader,
  runStatusLabels,
  ToggleGroup,
  ToggleGroupItem,
} from "@deevy/design-system";
import { Plus } from "lucide-react";

export const WithActions = () => (
  <PageHeader
    title="Agents"
    description="The Agents in this Workspace, and the Humans who sponsor them."
    actions={
      <Button>
        <Plus data-icon="inline-start" /> New Agent
      </Button>
    }
  />
);

/** A row under the title: the Runs feed's filters. */
export const WithChildren = () => (
  <PageHeader title="Runs" description="What your Agents have been doing.">
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <ToggleGroup defaultValue={["active"]} variant="outline" spacing={0}>
        {(["active", "awaiting_input", "completed"] as const).map((status) => (
          <ToggleGroupItem key={status} value={status}>
            {runStatusLabels[status]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button size="sm" variant="outline">
        Mine
      </Button>
    </div>
  </PageHeader>
);

export const TitleOnly = () => (
  <PageHeader title="Needs me" description="Rulings, and what your Agents are doing." />
);

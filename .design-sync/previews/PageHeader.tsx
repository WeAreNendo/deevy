import {
  Button,
  PageHeader,
  runStatusLabels,
  ToggleGroup,
  ToggleGroupItem,
} from "@deevy/design-system";

/** A title and the page's action on the right: Settings › Agents. */
export const WithActions = () => <PageHeader title="Agents" actions={<Button>New Agent</Button>} />;

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

/** A title and one line on what the page is for: the home page. */
export const WithDescription = () => (
  <PageHeader title="Needs me" description="Rulings, and what your Agents are doing." />
);

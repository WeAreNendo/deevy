import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@deevy/design-system";
import { ChevronDown } from "lucide-react";

// No screen folds anything, so the words are of no product.
const Fold = ({ open }: { open: boolean }) => (
  <Collapsible defaultOpen={open} className="w-80 rounded-md border bg-card">
    <CollapsibleTrigger
      render={
        <Button
          variant="ghost"
          size="sm"
          className="group w-full justify-start rounded-b-none text-muted-foreground"
        />
      }
    >
      <ChevronDown
        data-icon="inline-start"
        className="transition-transform group-aria-expanded:rotate-180"
      />
      Details
    </CollapsibleTrigger>
    <CollapsibleContent>
      <p className="border-t px-3 py-2 text-sm text-muted-foreground">
        What the fold holds, which takes no room until it is opened.
      </p>
    </CollapsibleContent>
  </Collapsible>
);

/** Open: the content shows under the trigger. */
export const Open = () => <Fold open />;

/** Closed, only the trigger and the chevron. */
export const Closed = () => <Fold open={false} />;

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  MemberChip,
} from "@deevy/design-system";
import { ChevronDown } from "lucide-react";
import { ada, planner } from "../fixtures";

const earlier = [
  { who: planner, what: "started a Run", when: "3d" },
  { who: planner, what: "stopped at plan", when: "3d" },
  { who: ada, what: "approved at plan", when: "2d" },
];

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
      <span className="tabular-nums">3</span> earlier Events
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ul className="flex flex-col gap-2 border-t px-3 py-2">
        {earlier.map((event) => (
          <li key={event.what} className="flex items-center gap-2 text-sm">
            <MemberChip member={event.who} size="xs" />
            <span className="text-muted-foreground">{event.what}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{event.when}</span>
          </li>
        ))}
      </ul>
    </CollapsibleContent>
  </Collapsible>
);

/** A record's history folds what came before: open, the Events show. */
export const Open = () => <Fold open />;

/** Closed, only the count and the chevron. */
export const Closed = () => <Fold open={false} />;

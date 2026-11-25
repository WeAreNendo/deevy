import {
  Button,
  Kbd,
  MemberChip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@deevy/design-system";
import { Info } from "lucide-react";
import { ada, builder } from "../fixtures";

/** A MemberChip says what kind of Member it is on hover, by itself; held open here so the card shows both. */
export const OnMembers = () => (
  <TooltipProvider>
    <div className="flex flex-wrap items-center gap-24 pt-12 pl-12">
      <Tooltip open>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <MemberChip member={ada} />
        </TooltipTrigger>
        <TooltipContent>Human</TooltipContent>
      </Tooltip>
      <Tooltip open>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <MemberChip member={builder} />
        </TooltipTrigger>
        <TooltipContent>Agent</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

/** Below an icon button, naming it; a Kbd inside takes the tooltip's colours. The words are of no product. */
export const WithKbd = () => (
  <TooltipProvider>
    <div className="flex min-h-24 items-start">
      <Tooltip open>
        <TooltipTrigger render={<Button size="icon-sm" variant="outline" aria-label="Details" />}>
          <Info />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Details <Kbd>⌘1</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

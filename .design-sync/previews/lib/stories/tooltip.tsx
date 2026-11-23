import {
  Avatar,
  AvatarFallback,
  Button,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@deevy/design-system";
import { Bot, Keyboard } from "lucide-react";

/** A chip says what kind of Member it is on hover; open here so the card shows both. */
export const OnMembers = () => (
  <TooltipProvider>
    <div className="flex flex-wrap items-center gap-12 pt-12">
      <Tooltip open>
        <TooltipTrigger render={<span className="inline-flex items-center gap-2 text-sm" />}>
          <Avatar className="size-7 rounded-full text-xs ring-1 ring-human ring-offset-1 ring-offset-background">
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
          Ada Lovelace
        </TooltipTrigger>
        <TooltipContent>Human</TooltipContent>
      </Tooltip>
      <Tooltip open>
        <TooltipTrigger render={<span className="inline-flex items-center gap-2 text-sm" />}>
          <Avatar className="size-7 rounded-sm text-xs ring-1 ring-agent ring-offset-1 ring-offset-background">
            <AvatarFallback>
              <Bot className="size-3.5" />
            </AvatarFallback>
          </Avatar>
          Builder
        </TooltipTrigger>
        <TooltipContent>Agent, sponsored by Ada Lovelace</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

/** Below an action, with its shortcut as a Kbd. */
export const WithShortcut = () => (
  <TooltipProvider>
    <div className="flex min-h-24 items-start">
      <Tooltip open>
        <TooltipTrigger
          render={<Button size="icon-sm" variant="outline" aria-label="Keyboard shortcuts" />}
        >
          <Keyboard />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Keyboard shortcuts <Kbd>?</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

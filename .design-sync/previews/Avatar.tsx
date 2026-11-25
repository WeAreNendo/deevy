import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@deevy/design-system";
import { Bot, Check } from "lucide-react";

/** No picture, so the initials: a Human is round; an Agent is square, the shape MemberChip gives it. */
export const Fallback = () => (
  <div className="flex items-center gap-4">
    <Avatar className="size-8">
      <AvatarImage src="" alt="Ada Lovelace" />
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
    <Avatar className="size-8">
      <AvatarFallback>GH</AvatarFallback>
    </Avatar>
    <Avatar className="size-8">
      <AvatarFallback className="rounded-md text-agent">
        <Bot className="size-4" />
      </AvatarFallback>
    </Avatar>
    <Avatar className="size-8 ring-2 ring-human">
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-4">
    <Avatar size="sm">
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  </div>
);

/** Overlapping Humans, as a Checkpoint shows who may rule on it; two initials need the smaller type and a 6px overlap to stay whole. */
export const Group = () => (
  <div className="flex items-center gap-4">
    <AvatarGroup className="-space-x-1.5">
      <Avatar>
        <AvatarFallback className="bg-human/15 text-[11px] font-medium text-human">
          AL
        </AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="bg-human/15 text-[11px] font-medium text-human">
          GH
        </AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="bg-human/15 text-[11px] font-medium text-human">
          OH
        </AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+2</AvatarGroupCount>
    </AvatarGroup>
    <AvatarGroup className="-space-x-1.5">
      <Avatar size="sm">
        <AvatarFallback className="bg-human/15 text-[9px] font-medium text-human">
          AL
        </AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback className="bg-human/15 text-[9px] font-medium text-human">
          GH
        </AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+4</AvatarGroupCount>
    </AvatarGroup>
  </div>
);

/** A dot in the corner: an Agent with a Run going, or a Human who has approved. */
export const WithBadge = () => (
  <div className="flex items-center gap-4">
    <Avatar size="sm">
      <AvatarFallback>AL</AvatarFallback>
      <AvatarBadge className="bg-human" />
    </Avatar>
    <Avatar>
      <AvatarFallback>GH</AvatarFallback>
      <AvatarBadge className="bg-human">
        <Check />
      </AvatarBadge>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback className="rounded-md">
        <Bot className="size-5 text-agent" />
      </AvatarFallback>
      <AvatarBadge className="bg-agent" />
    </Avatar>
  </div>
);

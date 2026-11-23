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

/** The Humans who may rule on a Gate, folded past three. */
export const Group = () => (
  <div className="flex items-center gap-4">
    <AvatarGroup>
      <Avatar>
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>GH</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>OH</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+2</AvatarGroupCount>
    </AvatarGroup>
    <AvatarGroup>
      <Avatar size="sm">
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>GH</AvatarFallback>
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

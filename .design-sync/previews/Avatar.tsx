import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@deevy/design-system";
import { Check } from "lucide-react";

// The part MemberChip is built from. A Member is always a MemberChip, which
// gives the avatar its shape and ring by kind; no screen draws an Avatar alone,
// groups them or puts a badge on one, so the words here are only initials.

/** No picture, so the initials; or the picture. */
export const Fallback = () => (
  <div className="flex items-center gap-4">
    <Avatar className="size-8">
      <AvatarImage src="" alt="" />
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
    <Avatar className="size-8">
      <AvatarFallback>CD</AvatarFallback>
    </Avatar>
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-4">
    <Avatar size="sm">
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
  </div>
);

/** Overlapping; two initials need the smaller type and a shallower overlap to stay whole. The type's size goes on the fallback, which sets its own. */
export const Group = () => (
  <div className="flex items-center gap-4">
    <AvatarGroup className="-space-x-1.5">
      <Avatar>
        <AvatarFallback className="text-[11px] font-medium">AB</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="text-[11px] font-medium">CD</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="text-[11px] font-medium">EF</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+2</AvatarGroupCount>
    </AvatarGroup>
    <AvatarGroup className="-space-x-1">
      <Avatar size="sm">
        <AvatarFallback className="text-[9px] font-medium">AB</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback className="text-[9px] font-medium">CD</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+4</AvatarGroupCount>
    </AvatarGroup>
  </div>
);

/** A dot in the corner, or an icon in it. */
export const WithBadge = () => (
  <div className="flex items-center gap-4">
    <Avatar size="sm">
      <AvatarFallback>AB</AvatarFallback>
      <AvatarBadge />
    </Avatar>
    <Avatar>
      <AvatarFallback>CD</AvatarFallback>
      <AvatarBadge>
        <Check />
      </AvatarBadge>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback>EF</AvatarFallback>
      <AvatarBadge />
    </Avatar>
  </div>
);

import { Fragment } from "react";
import { MemberChip } from "@deevy/design-system";
import { ada, builder, grace, planner, suspendedAgent } from "./lib/fixtures";

/** A Human is a round avatar ringed in indigo; an Agent a square one ringed in rose. */
export const HumanAndAgent = () => (
  <div className="flex flex-wrap items-center gap-6">
    <MemberChip member={ada} />
    <MemberChip member={planner} sponsorName="Ada Lovelace" />
  </div>
);

/** One row per size, a Human beside an Agent: `xs` in a table cell, `sm` in rows, `md` in a rail, `lg` as a page's title. */
export const Sizes = () => (
  <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-6 gap-y-3">
    {(["xs", "sm", "md", "lg"] as const).map((size) => (
      <Fragment key={size}>
        <span className="font-mono text-xs text-muted-foreground">{size}</span>
        <MemberChip member={grace} size={size} />
        <MemberChip member={builder} size={size} />
      </Fragment>
    ))}
  </div>
);

/** `inline` sits in a line of text, the height of the words either side of it. */
export const Inline = () => (
  <div className="flex max-w-md flex-col gap-2 text-sm text-muted-foreground">
    <p>
      <MemberChip member={planner} size="inline" /> asked for a ruling at{" "}
      <span className="font-mono">plan</span> on <span className="font-mono">acme/deevy#412</span>.
    </p>
    <p>
      <MemberChip member={ada} size="inline" /> approved it, 1 of 1.
    </p>
  </div>
);

/** Only the name, for a timeline: an Agent's name takes the Agent colour. */
export const NameOnly = () => (
  <ol className="flex flex-col gap-1.5 text-sm">
    <li className="flex items-baseline gap-2">
      <span className="w-12 text-xs tabular-nums text-muted-foreground">10:02</span>
      <MemberChip member={builder} nameOnly />
      <span className="text-muted-foreground">started a Run</span>
    </li>
    <li className="flex items-baseline gap-2">
      <span className="w-12 text-xs tabular-nums text-muted-foreground">10:16</span>
      <MemberChip member={grace} nameOnly />
      <span className="text-muted-foreground">approved at ship</span>
    </li>
  </ol>
);

/** The handle in mono where a name alone is ambiguous. */
export const WithHandle = () => (
  <div className="flex flex-wrap items-center gap-6">
    <MemberChip member={ada} showHandle />
    <MemberChip member={planner} showHandle />
  </div>
);

/** A suspended Member is dimmed; the avatar alone is for the folded sidebar. */
export const SuspendedAndAvatarOnly = () => (
  <div className="flex flex-wrap items-center gap-6">
    <MemberChip member={suspendedAgent} />
    <MemberChip member={ada} avatarOnly size="md" />
    <MemberChip member={builder} avatarOnly size="md" />
  </div>
);

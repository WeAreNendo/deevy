import { Fragment } from "react";
import { Badge, MemberChip } from "@deevy/design-system";
import { ada, builder, grace, planner, suspendedAgent } from "./lib/fixtures";

/** A Human is a round avatar ringed in indigo; an Agent a square one ringed in rose. */
export const HumanAndAgent = () => (
  <div className="flex flex-wrap items-center gap-6">
    <MemberChip member={ada} />
    <MemberChip member={planner} sponsorName="Ada Lovelace" />
  </div>
);

/** One row per size, a Human beside an Agent: `xs` in a table cell, `sm` in a list of Members, `md` at the sidebar's foot, `lg` as an Agent's page's title. */
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

/** `inline` sits in a line of text, the height of the words either side of it: under a Gate's title, under a record's, in a Gate's decisions. */
export const Inline = () => (
  <div className="flex max-w-md flex-col gap-3 text-sm text-muted-foreground">
    <span>
      <MemberChip member={planner} size="inline" /> asked at the{" "}
      <span className="font-medium">plan</span> Checkpoint
    </span>
    <span className="flex items-center gap-1 text-xs">
      routed to <MemberChip member={builder} size="inline" />
    </span>
    <span className="flex flex-wrap items-center gap-2">
      <MemberChip member={grace} size="inline" />
      <Badge variant="outline" className="border-state-done/40 text-state-done">
        Approved
      </Badge>
      <span className="text-xs">1 hour ago</span>
    </span>
  </div>
);

/** Only the name, for a timeline: an Agent's name takes the Agent colour, and what deevy did has no Member. A record's "What happened", newest first. */
export const NameOnly = () => (
  <ol aria-label="Events" className="flex flex-col gap-2">
    <li className="flex items-baseline gap-2 text-sm">
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 translate-y-[4.75px] rounded-full bg-agent"
      />
      <span className="flex min-w-0 flex-wrap items-baseline gap-1">
        <MemberChip member={builder} size="inline" nameOnly />
        <span>added a pull_request on github.com</span>
        <span className="text-xs text-muted-foreground">3 hours ago</span>
      </span>
    </li>
    <li className="flex items-baseline gap-2 text-sm">
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 translate-y-[4.75px] rounded-full bg-muted-foreground/40"
      />
      <span className="flex min-w-0 flex-wrap items-baseline gap-1">
        <span className="text-muted-foreground">deevy</span>
        <span>routed it to Builder</span>
        <span className="text-xs text-muted-foreground">4 hours ago</span>
      </span>
    </li>
  </ol>
);

/** The handle in mono where a name alone is ambiguous. */
export const WithHandle = () => (
  <div className="flex flex-wrap items-center gap-6">
    <MemberChip member={planner} showHandle />
    <MemberChip member={builder} showHandle />
  </div>
);

/** A suspended Member is dimmed; the avatar alone is for the folded sidebar. */
export const SuspendedAndAvatarOnly = () => (
  <div className="flex flex-wrap items-center gap-6">
    <MemberChip member={suspendedAgent} />
    <MemberChip member={ada} avatarOnly size="md" />
  </div>
);

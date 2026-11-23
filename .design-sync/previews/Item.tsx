import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  MemberChip,
  RunStatus,
} from "@deevy/design-system";
import { builder, grace, planner } from "./lib/fixtures";

const Waiting = () => <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-gate" />;

/** One Gate on Needs me: who stopped at which Checkpoint on which record, its title under it, the way in beside it. */
export const GateRow = () => (
  <Item variant="outline" className="max-w-lg">
    <ItemMedia>
      <MemberChip member={planner} avatarOnly size="md" />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>
        <span>
          Planner stopped at plan on <span className="font-mono text-xs">acme/deevy#412</span>
        </span>
      </ItemTitle>
      <ItemDescription>Cursor-based paging on every list operation</ItemDescription>
    </ItemContent>
    <ItemActions>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">12m</span>
      <Waiting />
      <Button variant="ghost" size="xs">
        Open Gate
      </Button>
    </ItemActions>
  </Item>
);

/** Needs me: rows in an ItemGroup, a separator between the Gates and your Agents' Runs. */
export const NeedsMe = () => (
  <ItemGroup className="max-w-lg">
    <Item variant="outline">
      <ItemMedia>
        <MemberChip member={planner} avatarOnly size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span>
            Planner stopped at plan on <span className="font-mono text-xs">acme/deevy#412</span>
          </span>
        </ItemTitle>
        <ItemDescription>Cursor-based paging on every list operation</ItemDescription>
      </ItemContent>
      <ItemActions>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">12m</span>
        <Waiting />
        <Button variant="ghost" size="xs">
          Open Gate
        </Button>
      </ItemActions>
    </Item>
    <Item variant="outline">
      <ItemMedia>
        <MemberChip member={grace} avatarOnly size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span>
            Grace Hopper approved ship on <span className="font-mono text-xs">acme/deevy#409</span>
          </span>
        </ItemTitle>
        <ItemDescription>
          Sign the delivery id · <span className="tabular-nums">1 of 2</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">2h</span>
        <Waiting />
        <Button variant="ghost" size="xs">
          Open Gate
        </Button>
      </ItemActions>
    </Item>
    <ItemSeparator />
    <Item variant="outline">
      <ItemMedia>
        <MemberChip member={builder} avatarOnly size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span>
            Builder failed on <span className="font-mono text-xs">acme/ops#88</span>
          </span>
        </ItemTitle>
        <ItemDescription>“The registry refused the new key.”</ItemDescription>
      </ItemContent>
      <ItemActions>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">5h</span>
      </ItemActions>
    </Item>
  </ItemGroup>
);

/** The three looks: default sits flat, outline has a border, muted a tint. */
export const Variants = () => (
  <div className="flex max-w-lg flex-col gap-2">
    <Item variant="default">
      <ItemMedia>
        <MemberChip member={grace} avatarOnly size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span>
            Grace Hopper approved ship on <span className="font-mono text-xs">acme/deevy#409</span>
          </span>
        </ItemTitle>
        <ItemDescription>default</ItemDescription>
      </ItemContent>
    </Item>
    <Item variant="outline">
      <ItemMedia>
        <MemberChip member={grace} avatarOnly size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span>
            Grace Hopper approved ship on <span className="font-mono text-xs">acme/deevy#409</span>
          </span>
        </ItemTitle>
        <ItemDescription>outline</ItemDescription>
      </ItemContent>
    </Item>
    <Item variant="muted">
      <ItemMedia>
        <MemberChip member={grace} avatarOnly size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <span>
            Grace Hopper approved ship on <span className="font-mono text-xs">acme/deevy#409</span>
          </span>
        </ItemTitle>
        <ItemDescription>muted</ItemDescription>
      </ItemContent>
    </Item>
  </div>
);

/** A Run as an Item, with a header line and a footer line spanning the row. */
export const WithHeaderAndFooter = () => (
  <Item variant="outline" className="max-w-lg">
    <ItemHeader>
      <span className="font-mono text-xs text-muted-foreground">run_3n7p0w5d8e2f</span>
      <RunStatus status="active" />
    </ItemHeader>
    <ItemMedia>
      <MemberChip member={builder} avatarOnly size="md" />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>
        <span>
          Builder is working on <span className="font-mono text-xs">acme/deevy#409</span>
        </span>
      </ItemTitle>
      <ItemDescription>
        Adding the delivery id to the signed payload; a test for a replayed delivery is next.
      </ItemDescription>
    </ItemContent>
    <ItemActions>
      <Button variant="outline" size="xs">
        Open Run
      </Button>
    </ItemActions>
    <ItemFooter>
      <span className="text-muted-foreground tabular-nums">Working for 41m</span>
      <span className="text-muted-foreground">Sponsored by Ada Lovelace</span>
    </ItemFooter>
  </Item>
);

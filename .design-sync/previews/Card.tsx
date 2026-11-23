import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Markdown,
  MemberChip,
  RunStatus,
} from "@deevy/design-system";
import { ada, planner } from "./lib/fixtures";

const summary = `Opened **acme/deevy#406** with the signature change.

- Signed the delivery id along with the payload
- Added a test for a replayed delivery`;

/** A Run: what the Agent did on a record, where it stands in the corner, and the Agent who ran it. */
export const Run = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>
        Run on <span className="font-mono">acme/deevy#405</span>
      </CardTitle>
      <CardDescription className="tabular-nums">Started 3h ago · worked 22m</CardDescription>
      <CardAction>
        <RunStatus status="completed" />
      </CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <MemberChip member={planner} size="sm" sponsorName="Ada Lovelace" />
      <Markdown>{summary}</Markdown>
    </CardContent>
    <CardFooter className="justify-between border-t">
      <span className="font-mono text-xs text-muted-foreground">run_6t1v9b4h0j3k</span>
      <Button variant="ghost" size="sm">
        Open Run
      </Button>
    </CardFooter>
  </Card>
);

/** A Run stopped at a Gate, waiting on a Human's Ruling: the card leads to the Gate. */
export const RunAwaitingInput = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>
        Run on <span className="font-mono">acme/deevy#412</span>
      </CardTitle>
      <CardDescription className="tabular-nums">Started 16 min ago · worked 14m</CardDescription>
      <CardAction>
        <RunStatus status="awaiting_input" label="Waiting at plan" />
      </CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <MemberChip member={planner} size="sm" sponsorName="Ada Lovelace" />
      <Markdown>
        {
          "Wrote the plan for *cursor paging*. It waits at `plan` for a Human to approve before I touch a list operation."
        }
      </Markdown>
    </CardContent>
    <CardFooter className="gap-2 border-t">
      {/* A Ruling is made on the Gate's own page; a card only leads there. */}
      <Button size="sm">Open the Gate</Button>
      <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">0 of 1</span>
    </CardFooter>
  </Card>
);

/** A Socket: the tool deevy is connected to, and whether it is delivering. */
export const Socket = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>GitHub · acme</CardTitle>
      <CardDescription>
        A GitHub App on <span className="font-mono">acme/deevy</span> and{" "}
        <span className="font-mono">acme/ops</span>
      </CardDescription>
      <CardAction>
        <Badge variant="secondary">Connected</Badge>
      </CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-1">
      <span>
        Last delivery 4 min ago, about <span className="font-mono text-xs">acme/deevy#409</span>.
      </span>
      <span className="text-muted-foreground">Connected by</span>
      <MemberChip member={ada} size="xs" />
    </CardContent>
    <CardFooter className="gap-2">
      <Button variant="outline" size="sm">
        Pause
      </Button>
      <Button variant="destructive" size="sm">
        Disconnect
      </Button>
    </CardFooter>
  </Card>
);

/** `size="sm"`: tighter spacing for a card in a list of cards. */
export const Small = () => (
  <Card size="sm" className="max-w-sm">
    <CardHeader>
      <CardTitle>
        Run on <span className="font-mono">acme/ops#88</span>
      </CardTitle>
      <CardDescription className="tabular-nums">5h ago · failed after 6m</CardDescription>
      <CardAction>
        <RunStatus status="failed" />
      </CardAction>
    </CardHeader>
    <CardContent>
      <Markdown>{"The registry refused the new key: `401` on `docker push`."}</Markdown>
    </CardContent>
  </Card>
);

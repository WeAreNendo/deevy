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
import { failedRun, finishedRun, planGate, waitingRun } from "./lib/fixtures";

// No screen uses Card: a Run and a Gate are bordered rows, a Socket is a
// SettingsSection. These say the same things in the same words.

/** A Run that finished: the record, where it stands, the Agent, its summary and how long it worked. */
export const Run = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle className="font-mono">{finishedRun.record}</CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-2">
        <MemberChip member={finishedRun.agent} size="inline" />
        <span>started by assignment</span>
        <span aria-hidden>·</span>
        <span>{finishedRun.last}</span>
      </CardDescription>
      <CardAction>
        <RunStatus status={finishedRun.status} />
      </CardAction>
    </CardHeader>
    <CardContent className="text-sm">{finishedRun.summary}</CardContent>
    <CardFooter className="justify-between border-t text-xs text-muted-foreground">
      <span className="font-mono">{finishedRun.id}</span>
      <span className="tabular-nums">Working {finishedRun.time}</span>
    </CardFooter>
  </Card>
);

/** A Run stopped at a Gate: an Activity in markdown, then the Checkpoint and the count. */
export const RunAtAGate = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle className="font-mono">{waitingRun.record}</CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-2">
        <MemberChip member={waitingRun.agent} size="inline" />
        <span>{waitingRun.last}</span>
      </CardDescription>
      <CardAction>
        <RunStatus status={waitingRun.status} />
      </CardAction>
    </CardHeader>
    <CardContent>
      <Markdown>{"Read the three list operations that still page by `offset`."}</Markdown>
    </CardContent>
    <CardFooter className="gap-2 border-t">
      <Badge variant="outline">{planGate.checkpoint}</Badge>
      <span className="text-sm text-muted-foreground tabular-nums">
        {planGate.approvals} of {planGate.required}
      </span>
    </CardFooter>
  </Card>
);

/** A Socket, as its page says it is doing. */
export const Socket = () => (
  <Card className="max-w-md">
    <CardHeader>
      <CardTitle>acme on GitHub</CardTitle>
      <CardDescription>A GitHub Socket, as acme-deevy[bot].</CardDescription>
      <CardAction>
        <Badge variant="outline">GitHub</Badge>
      </CardAction>
    </CardHeader>
    <CardContent className="text-sm">Spoke 4 minutes ago</CardContent>
    <CardFooter className="gap-2">
      <Button variant="outline" size="sm">
        Ask who deevy is there
      </Button>
      <Button variant="outline" size="sm">
        Pause
      </Button>
    </CardFooter>
  </Card>
);

/** `size="sm"`: tighter spacing for a card in a list of cards. */
export const Small = () => (
  <Card size="sm" className="max-w-sm">
    <CardHeader>
      <CardTitle className="font-mono">{failedRun.record}</CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-2">
        <MemberChip member={failedRun.agent} size="inline" />
        <span>{failedRun.last}</span>
      </CardDescription>
      <CardAction>
        <RunStatus status={failedRun.status} />
      </CardAction>
    </CardHeader>
    <CardContent className="text-sm">{failedRun.summary}</CardContent>
  </Card>
);

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deevy/design-system";

const endpoint = "https://deevy.example.com/mcp";

/** Connect an Agent: one tab per coding agent, where its entry goes and what to write below. */
export const ConnectAgent = () => (
  <Tabs defaultValue="claude-code">
    <TabsList aria-label="Coding agent">
      <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
      <TabsTrigger value="opencode">OpenCode</TabsTrigger>
      <TabsTrigger value="cursor">Cursor CLI</TabsTrigger>
    </TabsList>
    <TabsContent value="claude-code" className="flex max-w-prose flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Run this where the Agent works, and it writes the entry itself.
      </p>
      <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
        {`claude mcp add --transport http deevy ${endpoint} \\\n  --header "Authorization: Bearer $DEEVY_AGENT_KEY"`}
      </pre>
    </TabsContent>
    <TabsContent value="opencode">
      <p className="text-sm text-muted-foreground">
        In opencode.json, beside the repository or under ~/.config/opencode.
      </p>
    </TabsContent>
    <TabsContent value="cursor">
      <p className="text-sm text-muted-foreground">
        In ~/.cursor/mcp.json, the same file the editor reads.
      </p>
    </TabsContent>
  </Tabs>
);

/** The Proposal's view switch, small, in the toolbar above it on a Gate. */
export const ProposalView = () => (
  <div className="rounded-md border bg-card">
    <div className="flex items-center justify-end border-b px-1 py-1">
      <Tabs defaultValue="source">
        <TabsList aria-label="Proposal view" className="h-7">
          <TabsTrigger value="rendered" className="text-xs">
            Rendered
          </TabsTrigger>
          <TabsTrigger value="source" className="text-xs">
            Source
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <p className="px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
      ## Plan{"\n"}Page every list operation by an opaque cursor instead of an offset.
    </p>
  </div>
);

/** The line variant: an underline instead of a filled pill. */
export const Line = () => (
  <Tabs defaultValue="activity">
    <TabsList variant="line" aria-label="Run">
      <TabsTrigger value="activity">Activity</TabsTrigger>
      <TabsTrigger value="gates">Gates</TabsTrigger>
      <TabsTrigger value="time">Time</TabsTrigger>
    </TabsList>
    <TabsContent value="activity">
      <p className="text-sm text-muted-foreground">
        Planner wrote the plan for cursor paging and stopped at{" "}
        <span className="font-mono">plan</span>.
      </p>
    </TabsContent>
  </Tabs>
);

/** Stacked, for a Settings nav: the active tab's mark sits on its right edge. */
export const Vertical = () => (
  <Tabs defaultValue="agents" orientation="vertical" className="w-64">
    <TabsList variant="line" aria-label="Settings">
      <TabsTrigger value="general">General</TabsTrigger>
      <TabsTrigger value="members">Members</TabsTrigger>
      <TabsTrigger value="sockets">Sockets</TabsTrigger>
      <TabsTrigger value="projects">Projects</TabsTrigger>
      <TabsTrigger value="agents">Agents</TabsTrigger>
      <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
    </TabsList>
    <TabsContent value="agents">
      <p className="text-sm text-muted-foreground">Two Agents, both sponsored by Ada.</p>
    </TabsContent>
  </Tabs>
);

/** A view with nothing in it cannot be opened: this Run has asked for nothing yet. */
export const Disabled = () => (
  <Tabs defaultValue="activity">
    <TabsList aria-label="Run">
      <TabsTrigger value="activity">Activity</TabsTrigger>
      <TabsTrigger value="gates" disabled>
        Gates
      </TabsTrigger>
      <TabsTrigger value="time">Time</TabsTrigger>
    </TabsList>
  </Tabs>
);

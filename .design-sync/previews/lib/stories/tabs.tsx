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

/** Small, in a toolbar above the thing it shows: the same entry, one way or another. */
export const Small = () => (
  <div className="rounded-md border bg-card">
    <div className="flex items-center justify-end border-b px-1 py-1">
      <Tabs defaultValue="opencode">
        <TabsList aria-label="Coding agent" className="h-7">
          <TabsTrigger value="claude-code" className="text-xs">
            Claude Code
          </TabsTrigger>
          <TabsTrigger value="opencode" className="text-xs">
            OpenCode
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <p className="px-3 py-2 font-mono text-xs text-muted-foreground">opencode.json</p>
  </div>
);

/** The line variant: an underline instead of a filled pill. */
export const Line = () => (
  <Tabs defaultValue="cursor">
    <TabsList variant="line" aria-label="Coding agent">
      <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
      <TabsTrigger value="opencode">OpenCode</TabsTrigger>
      <TabsTrigger value="cursor">Cursor CLI</TabsTrigger>
    </TabsList>
    <TabsContent value="cursor">
      <p className="text-sm text-muted-foreground">
        In <span className="font-mono">~/.cursor/mcp.json</span>, the same file the editor reads.
      </p>
    </TabsContent>
  </Tabs>
);

/** Stacked: the active tab's mark sits on its right edge. */
export const Vertical = () => (
  <Tabs defaultValue="copilot" orientation="vertical" className="w-full">
    <TabsList variant="line" aria-label="Coding agent">
      <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
      <TabsTrigger value="opencode">OpenCode</TabsTrigger>
      <TabsTrigger value="cursor">Cursor CLI</TabsTrigger>
      <TabsTrigger value="copilot">Copilot CLI</TabsTrigger>
      <TabsTrigger value="other">Anything else</TabsTrigger>
    </TabsList>
    <TabsContent value="copilot">
      <p className="text-sm text-muted-foreground">One entry, and the Agent&apos;s key.</p>
    </TabsContent>
  </Tabs>
);

/** A view that cannot be opened yet. */
export const Disabled = () => (
  <Tabs defaultValue="claude-code">
    <TabsList aria-label="Coding agent">
      <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
      <TabsTrigger value="opencode" disabled>
        OpenCode
      </TabsTrigger>
      <TabsTrigger value="cursor">Cursor CLI</TabsTrigger>
    </TabsList>
  </Tabs>
);

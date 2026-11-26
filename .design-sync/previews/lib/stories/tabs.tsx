import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deevy/design-system";

const endpoint = "https://deevy.example.com/mcp";

// The coding agents, in the order lib/mcp.ts lists them, and where each one's
// entry goes. deevy's only tabs.
const agents = [
  {
    label: "Claude Code",
    where: "Run this where the Agent works, and it writes the entry itself.",
  },
  {
    label: "OpenCode",
    where: "In opencode.json, beside the repository or under ~/.config/opencode.",
  },
  { label: "Cursor CLI", where: "In ~/.cursor/mcp.json, the same file the editor reads." },
  { label: "Copilot CLI", where: "In ~/.copilot/mcp-config.json." },
  {
    label: "Anything else",
    where: "Any MCP client over streamable HTTP, with the key as a bearer token.",
  },
];

/** Connect an Agent: one tab per coding agent. The strip only chooses: what it says is under it, not in a TabsContent. What to write is drawn for the first one. */
export const ConnectAgent = () => {
  const [client, setClient] = useState(agents[0]!.label);
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <code className="w-fit rounded bg-muted px-2 py-1 text-sm">{endpoint}</code>
      <Tabs value={client} onValueChange={(next) => setClient(String(next))}>
        <TabsList aria-label="Coding agent" className="scrollbar-thin max-w-full overflow-x-auto">
          {agents.map((agent) => (
            <TabsTrigger key={agent.label} value={agent.label}>
              {agent.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">
        {agents.find((agent) => agent.label === client)?.where}
      </p>
      {client === agents[0]!.label ? (
        <>
          <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
            {"export DEEVY_AGENT_KEY=…   # the key, from when it was issued"}
          </pre>
          <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
            {`claude mcp add --transport http deevy ${endpoint} \\\n  --header "Authorization: Bearer $DEEVY_AGENT_KEY"`}
          </pre>
        </>
      ) : null}
    </div>
  );
};

// No screen has the ones below, so their words are of no product.

/** With its panels: the tab chooses what is under it. */
export const WithContent = () => (
  <Tabs defaultValue="one">
    <TabsList aria-label="Views">
      <TabsTrigger value="one">One</TabsTrigger>
      <TabsTrigger value="two">Two</TabsTrigger>
    </TabsList>
    <TabsContent value="one">
      <p className="text-sm text-muted-foreground">What the first one holds.</p>
    </TabsContent>
    <TabsContent value="two">
      <p className="text-sm text-muted-foreground">What the second one holds.</p>
    </TabsContent>
  </Tabs>
);

/** The line variant: an underline instead of a filled pill. */
export const Line = () => (
  <Tabs defaultValue="two">
    <TabsList variant="line" aria-label="Views">
      <TabsTrigger value="one">One</TabsTrigger>
      <TabsTrigger value="two">Two</TabsTrigger>
      <TabsTrigger value="three">Three</TabsTrigger>
    </TabsList>
  </Tabs>
);

/** Stacked: the active tab's mark sits on its right edge. */
export const Vertical = () => (
  <Tabs defaultValue="two" orientation="vertical" className="w-full">
    <TabsList variant="line" aria-label="Views">
      <TabsTrigger value="one">One</TabsTrigger>
      <TabsTrigger value="two">Two</TabsTrigger>
      <TabsTrigger value="three">Three</TabsTrigger>
    </TabsList>
    <TabsContent value="two">
      <p className="text-sm text-muted-foreground">What the second one holds.</p>
    </TabsContent>
  </Tabs>
);

/** One that cannot be opened. */
export const Disabled = () => (
  <Tabs defaultValue="one">
    <TabsList aria-label="Views">
      <TabsTrigger value="one">One</TabsTrigger>
      <TabsTrigger value="two" disabled>
        Two
      </TabsTrigger>
      <TabsTrigger value="three">Three</TabsTrigger>
    </TabsList>
  </Tabs>
);

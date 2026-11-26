// The stories for ResizablePanelGroup and its parts. Kept under lib/ with a non-component
// file name: a sibling named like an export is shimmed to the package by the
// story-imports plugin, so `export * from "./ResizablePanelGroup"` would re-export all of it.
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@deevy/design-system";

// No screen lets a panel be resized: a page with a rail is a grid, and so is a
// Settings page with a list beside it. The panels here are only panels.

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
    {children}
  </div>
);

/** Two panels side by side, a handle with a grip between. */
export const Horizontal = () => (
  <div className="h-48 w-full">
    <ResizablePanelGroup orientation="horizontal" className="rounded-md border bg-background">
      <ResizablePanel minSize={240} className="min-w-0">
        <Panel>One panel</Panel>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={300} minSize={220} className="min-w-0">
        <Panel>Another</Panel>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
);

/** Stacked: the handle is a horizontal bar. A vertical group needs a sized wrapper. */
export const Vertical = () => (
  <div className="h-56 w-full">
    <ResizablePanelGroup orientation="vertical" className="rounded-md border bg-background">
      <ResizablePanel defaultSize={110} minSize={60} className="min-h-0">
        <Panel>Above</Panel>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize={80} className="min-h-0">
        <Panel>Below</Panel>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
);

/** Without the grip: a plain hairline, still draggable. */
export const PlainHandle = () => (
  <div className="h-32 w-full">
    <ResizablePanelGroup orientation="horizontal" className="rounded-md border bg-background">
      <ResizablePanel className="min-w-0">
        <Panel>One panel</Panel>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="min-w-0">
        <Panel>Another</Panel>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
);

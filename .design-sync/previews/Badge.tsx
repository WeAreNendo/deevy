import { Badge } from "@deevy/design-system";
import { Bot, ExternalLink } from "lucide-react";

/** The six looks by name. deevy's screens use `secondary`, `outline` and `destructive`. */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>default</Badge>
    <Badge variant="secondary">secondary</Badge>
    <Badge variant="outline">outline</Badge>
    <Badge variant="destructive">destructive</Badge>
    <Badge variant="ghost">ghost</Badge>
    <Badge variant="link">link</Badge>
  </div>
);

/**
 * Where the app puts them: a Gate's Checkpoint in amber; a Ruling, outline in
 * green or red, never filled and never indigo, which is a Human; a Member on
 * Settings, a key that no longer works, a Socket.
 */
export const InContext = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
        ship
      </Badge>
      <Badge variant="outline" className="border-state-done/40 text-state-done">
        Approved
      </Badge>
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Rejected
      </Badge>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Planner</span>
      <Badge variant="secondary">Agent</Badge>
      <Badge variant="destructive">Suspended</Badge>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">laptop</span>
      <code className="font-mono text-xs text-muted-foreground">deevy_sk_a3xz…</code>
      <Badge variant="outline">Disabled</Badge>
    </div>
    <div className="flex items-center gap-2">
      <Badge variant="outline">Linear</Badge>
      <Badge variant="secondary">Preview</Badge>
      <span className="text-sm font-medium">Acme on Linear</span>
      <Badge variant="outline">paused</Badge>
    </div>
  </div>
);

/** A lucide icon at either end sits at 12px and pulls the padding in. */
export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="secondary">
      <Bot data-icon="inline-start" /> Agent
    </Badge>
    <Badge variant="outline" className="font-mono">
      acme/deevy#412 <ExternalLink data-icon="inline-end" />
    </Badge>
  </div>
);

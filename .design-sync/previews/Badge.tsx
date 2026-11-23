import { Badge } from "@deevy/design-system";
import { Bot, Check, X } from "lucide-react";

/** The six looks, each with the word deevy puts in it. */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Approved</Badge>
    <Badge variant="secondary">Agent</Badge>
    <Badge variant="outline">Archived</Badge>
    <Badge variant="destructive">Rejected</Badge>
    <Badge variant="ghost">Paused</Badge>
    <Badge variant="link" className="font-mono">
      acme/deevy#412
    </Badge>
  </div>
);

/** Where the app puts them: a role, a Member's kind, a key that no longer works, a Gate and its rulings. */
export const InContext = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <span className="font-medium">Grace Hopper</span>
      <Badge variant="outline">admin</Badge>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-medium">Reviewer</span>
      <Badge variant="secondary">Agent</Badge>
      <Badge variant="outline">Suspended</Badge>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-medium">old laptop</span>
      <code className="font-mono text-xs text-muted-foreground">dvy_a3xz…</code>
      <Badge variant="outline">Disabled</Badge>
    </div>
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
        ship
      </Badge>
      <Badge>Approved</Badge>
      <Badge variant="destructive">Rejected</Badge>
    </div>
  </div>
);

/** A lucide icon at either end sits at 12px and pulls the padding in. */
export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>
      <Check data-icon="inline-start" /> Approved
    </Badge>
    <Badge variant="destructive">
      <X data-icon="inline-start" /> Rejected
    </Badge>
    <Badge variant="secondary">
      <Bot data-icon="inline-start" /> Agent
    </Badge>
    <Badge variant="outline" className="tabular-nums">
      1 <span className="text-muted-foreground">of 2</span>
    </Badge>
  </div>
);

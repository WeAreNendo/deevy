import { Button, Shortcut } from "@deevy/design-system";

/** A combination, a chord, a single key. */
export const Kinds = () => (
  <div className="flex flex-wrap items-center gap-6">
    <Shortcut keys="mod+k" />
    <Shortcut keys="g r" />
    <Shortcut keys="j" />
    <Shortcut keys="mod+enter" />
    <Shortcut keys="shift+a" />
  </div>
);

/** Beside the thing it triggers, never instead of a label. */
export const BesideActions = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="outline">
      Search <Shortcut keys="mod+k" />
    </Button>
    <Button variant="outline">
      Approve <Shortcut keys="shift+a" />
    </Button>
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      Go to Runs <Shortcut keys="g r" />
    </span>
  </div>
);

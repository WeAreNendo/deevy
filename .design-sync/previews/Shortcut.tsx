import { Shortcut } from "@deevy/design-system";

/** A combination, a chord of two keys in sequence, a single key. */
export const Kinds = () => (
  <div className="flex flex-wrap items-center gap-6">
    <Shortcut keys="mod+k" />
    <Shortcut keys="g r" />
    <Shortcut keys="?" />
    <Shortcut keys="mod+enter" />
  </div>
);

/** The line under a Gate's Note: each key, then what it does. */
export const UnderAGatesNote = () => (
  <p className="text-xs text-muted-foreground">
    <Shortcut keys="shift+a" /> approve · <Shortcut keys="shift+r" /> reject ·{" "}
    <Shortcut keys="mod+enter" /> commit
  </p>
);

/** At the end of a sidebar's row, beside the label it triggers and never instead of it. */
export const InASidebarRow = () => (
  <div className="flex w-60 flex-col gap-2 text-sm">
    <span className="flex items-center gap-2 text-muted-foreground">
      Search or jump… <Shortcut keys="mod+k" className="ml-auto" />
    </span>
    <span className="flex items-center gap-2">
      Runs <Shortcut keys="g r" className="ml-auto" />
    </span>
    <span className="flex items-center gap-2">
      Work <Shortcut keys="g w" className="ml-auto" />
    </span>
  </div>
);

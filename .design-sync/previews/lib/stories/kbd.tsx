import { Kbd, KbdGroup } from "@deevy/design-system";

/** One key each: a letter, a symbol, a named key. */
export const SingleKeys = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Kbd>J</Kbd>
    <Kbd>?</Kbd>
    <Kbd>Esc</Kbd>
    <Kbd>↵</Kbd>
    <Kbd>↑</Kbd>
  </div>
);

/** A combination pressed together: jump, commit a Ruling, Approve. */
export const Group = () => (
  <div className="flex flex-wrap items-center gap-6">
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>↵</Kbd>
    </KbdGroup>
    <KbdGroup>
      <Kbd>⇧</Kbd>
      <Kbd>A</Kbd>
    </KbdGroup>
  </div>
);

/** A chord: two keys in sequence — G then R goes to Runs. */
export const Chord = () => (
  <KbdGroup>
    <Kbd>G</Kbd>
    <span className="text-xs text-muted-foreground/60">then</span>
    <Kbd>R</Kbd>
  </KbdGroup>
);

/** In running text, as a hint beside what it does. */
export const InText = () => (
  <p className="text-sm text-muted-foreground">
    Press <Kbd>?</Kbd> for every shortcut, or{" "}
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>{" "}
    to jump to a page, a Run or a record.
  </p>
);

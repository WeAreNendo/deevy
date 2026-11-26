import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { isMac } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const glyphs: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  enter: "↵",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  space: "␣",
};

/** One key as a person reads it: `mod` is ⌘ on a Mac and Ctrl elsewhere. */
export function keyLabel(key: string): string {
  if (key === "mod") return isMac() ? "⌘" : "Ctrl";
  return glyphs[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/**
 * A shortcut drawn beside the thing it triggers, in the syntax lib/shortcuts.ts
 * reads: `mod+k` is one combination, `g r` a chord of two keys in sequence.
 */
export function Shortcut({ keys, className }: { keys: string; className?: string }) {
  const chord = keys.split(" ");
  return (
    // Decoration: a hint must not become part of the button's name.
    <KbdGroup
      aria-hidden
      data-slot="shortcut"
      data-keys={keys}
      className={cn("font-mono", className)}
    >
      {chord.map((combo, index) => (
        <span key={`${combo}-${String(index)}`} className="flex items-center gap-0.5">
          {index > 0 ? <span className="text-muted-foreground/60">then</span> : null}
          {combo.split("+").map((key) => (
            <Kbd key={key}>{keyLabel(key)}</Kbd>
          ))}
        </span>
      ))}
    </KbdGroup>
  );
}

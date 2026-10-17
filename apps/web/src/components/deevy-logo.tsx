/*
 * deevy's logo, drawn from @deevy/design's data (brand/build.py writes it).
 *
 * The mark is a "d" made of two halves, a Human's and an Agent's, so it takes
 * the --human and --agent tokens and follows the theme. The word is Outfit
 * SemiBold as outlines, in the text colour around it.
 */
import { bar, disc, lockupBox, markBox, word, wordAt } from "@deevy/design/logo";
import { cn } from "@/lib/utils";

/** The mark alone. Decoration: whatever it sits in says "deevy". */
export function DeevyMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg viewBox={markBox} aria-hidden className={cn("h-6 w-auto", className)} {...props}>
      <path d={disc} className="fill-human" />
      <path d={bar} className="fill-agent" />
    </svg>
  );
}

/** The mark and the word, named "deevy". */
export function DeevyLogo({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox={lockupBox}
      role="img"
      aria-label="deevy"
      className={cn("h-7 w-auto", className)}
      {...props}
    >
      <path d={disc} className="fill-human" />
      <path d={bar} className="fill-agent" />
      <path d={word} transform={`translate(${wordAt.x} ${wordAt.y})`} fill="currentColor" />
    </svg>
  );
}

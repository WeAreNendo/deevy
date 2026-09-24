import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The name of a section in a rail: 12px, medium, muted — the size deevy sets
 * metadata in (.claude/skills/deevy-ui, round 2). A heading in the main column
 * is 14px and up; a rail's label is not one of those, and six sections each
 * spelling that out is six chances to drift.
 */
export function RailHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-xs font-medium text-muted-foreground", className)}>{children}</h2>;
}

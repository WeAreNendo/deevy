import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every screen: the h1 the tests find a page by, its one-line
 * description, and the actions that belong to the whole page. One component,
 * so the type scale is decided once (docs/plans/ui-redesign.md).
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A row under the title: filters, tabs, a strip of States. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3 border-b pb-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

import { Skeleton } from "@deevy/design-system";

/** What a DataTable shows while its rows load: six pulses the height of a row. */
export const Rows = () => (
  <div className="flex w-full max-w-lg flex-col gap-2 py-3" aria-busy="true">
    {Array.from({ length: 6 }, (_, index) => (
      <Skeleton key={index} className="h-7 w-full" />
    ))}
  </div>
);

/** Needs me before it has loaded: two, the height of its rows. */
export const NeedsMe = () => (
  <div className="flex w-full max-w-lg flex-col gap-3">
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-16 w-full" />
  </div>
);

/** A whole panel, the way a Settings page waits for its query. */
export const Block = () => <Skeleton className="h-40 w-full max-w-lg" />;

/** One control, waiting in its row. */
export const Control = () => <Skeleton className="h-9 w-72" />;

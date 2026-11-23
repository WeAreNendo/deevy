import { Skeleton } from "@deevy/design-system";

// The bundled CSS only carries the utilities the app itself uses, so a text-line
// height the app never renders (h-3) is set inline.
const line = { height: 12 };

/** What a DataTable shows while its rows load: six pulses the height of a row. */
export const Rows = () => (
  <div className="flex w-full max-w-lg flex-col gap-2 py-3" aria-busy="true">
    {Array.from({ length: 6 }, (_, index) => (
      <Skeleton key={index} className="h-7 w-full" />
    ))}
  </div>
);

/** A Run card before it has loaded: title and where it stands, chip, three lines of body. */
export const RunCard = () => (
  <div
    className="flex max-w-md flex-col gap-4 rounded-lg bg-card p-4 ring-1 ring-foreground/10"
    aria-busy="true"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="w-44" style={line} />
      </div>
      <Skeleton className="h-5 w-20 rounded-full" />
    </div>
    <div className="flex items-center gap-2">
      <Skeleton className="size-6 rounded-full" />
      <Skeleton className="w-24" style={line} />
    </div>
    <div className="flex flex-col gap-2">
      <Skeleton className="w-full" style={line} />
      <Skeleton className="w-full" style={line} />
      <Skeleton className="w-2/3" style={line} />
    </div>
  </div>
);

/** A row on Needs me: avatar, two lines, a time. */
export const NeedsMeRow = () => (
  <div className="flex max-w-lg items-start gap-2.5 px-3 py-2.5" aria-busy="true">
    <Skeleton className="size-8 shrink-0 rounded-full" />
    <div className="flex flex-1 flex-col gap-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="w-1/2" style={line} />
    </div>
    <Skeleton className="w-6" style={line} />
  </div>
);

/** A whole panel, the way a Settings page waits for its query. */
export const Block = () => <Skeleton className="h-32 w-full max-w-lg" />;

import { Button, Spinner } from "@deevy/design-system";

/** 16px by default; a size class overrides it. */
export const Sizes = () => (
  <div className="flex items-center gap-6">
    <Spinner className="size-3" />
    <Spinner />
    <Spinner className="size-6" />
    <Spinner className="size-8" />
  </div>
);

/** Beside the words that say what is going on. */
export const WithLabel = () => (
  <div className="flex flex-col gap-3">
    <span className="flex items-center gap-2 text-muted-foreground">
      <Spinner /> Loading Runs…
    </span>
    <span className="flex items-center gap-2 text-agent">
      <Spinner /> Builder is working on <span className="font-mono">acme/deevy#409</span>
    </span>
  </div>
);

/** Inside a Button while its action is pending. */
export const InButton = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled>
      <Spinner data-icon="inline-start" /> Connecting GitHub
    </Button>
    <Button variant="outline" disabled>
      <Spinner data-icon="inline-start" /> Reinstating
    </Button>
    <Button variant="destructive" size="sm" disabled>
      <Spinner data-icon="inline-start" /> Revoking
    </Button>
  </div>
);

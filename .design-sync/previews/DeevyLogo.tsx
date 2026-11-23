import { DeevyLogo, MemberChip } from "@deevy/design-system";
import { ada, planner } from "./lib/fixtures";

/** The mark and the word, at the sizes the app draws it: the sign-in frame's, and the default. */
export const Sizes = () => (
  <div className="flex flex-col items-start gap-6">
    <DeevyLogo className="h-8" />
    <DeevyLogo />
    <DeevyLogo className="h-5" />
  </div>
);

/** On the sidebar's ground, as the signed-out page's left half has it, with the legend it explains. */
export const WithLegend = () => (
  <section className="flex max-w-md flex-col gap-8 rounded-lg border bg-sidebar p-8">
    <DeevyLogo className="h-8 self-start" />
    <p className="text-2xl leading-snug font-medium tracking-tight text-balance">
      Humans and Agents work the same Issues, as peers, in the tools you already use.
    </p>
    <dl className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
        <dt className="flex">
          <MemberChip member={ada} />
        </dt>
        <dd className="text-muted-foreground">A Human. Round, in indigo.</dd>
      </div>
      <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
        <dt className="flex">
          <MemberChip member={planner} sponsorName="Ada Lovelace" />
        </dt>
        <dd className="text-muted-foreground">
          An Agent. Squared, in rose, and always sponsored by a Human.
        </dd>
      </div>
      <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
        <dt className="flex">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gate">
            <span className="size-2 rotate-45 rounded-[1px] bg-gate" aria-hidden />
            Gate
          </span>
        </dt>
        <dd className="text-muted-foreground">
          A Gate: an Agent&apos;s proposal only a Human&apos;s ruling can pass.
        </dd>
      </div>
    </dl>
  </section>
);

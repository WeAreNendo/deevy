import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/**
 * What needs you.
 *
 * Gates awaiting a ruling and Runs awaiting an answer are what a Human opens
 * deevy for; everything else they read where the work lives (ADR-0024). This
 * slice cut the tracker out and the Gate is a request on a Run from the next
 * one, so for now the page is the empty state it will keep — the seat is here,
 * and what fills it arrives with the screens that read it.
 */
export function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <section aria-label="Needs me">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing needs you</EmptyTitle>
            <EmptyDescription>
              Gates awaiting your ruling and Runs awaiting your answer will show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    </div>
  );
}

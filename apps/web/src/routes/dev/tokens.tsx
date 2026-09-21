import { MemberChip } from "@/components/member-chip";
import { RunStatus, runStatusLabels, type RunStatusValue } from "@/components/run-status";
import { Shortcut } from "@/components/kbd-hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const slots = [
  ["background", "paper"],
  ["foreground", "ink"],
  ["primary", "the one action colour"],
  ["human", "a Human Member"],
  ["agent", "an Agent"],
  ["gate", "a Gate, and anything owed a ruling"],
  ["destructive", "reject, revoke, delete"],
  ["muted", "quiet surfaces"],
  ["border", "rules"],
] as const;

const ada = { id: "a", kind: "human" as const, handle: "ada", user: { name: "Ada Lovelace" } };
const planner = { id: "p", kind: "agent" as const, handle: "planner", user: { name: "Planner" } };

function Sheet({ theme }: { theme: "light" | "dark" }) {
  return (
    <section
      className={cn(theme, "flex flex-col gap-6 bg-background p-6 text-foreground")}
      aria-label={`${theme} theme`}
    >
      <h2 className="text-base font-semibold">{theme === "dark" ? "Dark" : "Light"}</h2>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slots.map(([slot, meaning]) => (
          <li key={slot} className="flex items-center gap-3">
            <span
              aria-hidden
              className="size-8 shrink-0 rounded-md border"
              style={{ background: `var(--${slot})` }}
            />
            <span className="flex flex-col leading-tight">
              <span className="font-mono text-xs">--{slot}</span>
              <span className="text-xs text-muted-foreground">{meaning}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1">
        <p className="text-[28px] font-semibold tracking-tight">Ship the Event log view</p>
        <p className="text-xl font-semibold tracking-tight">Twenty for a page title</p>
        <p className="text-base">Sixteen for prose a person reads for a while.</p>
        <p className="text-sm">Fourteen is the interface: labels, rows, buttons.</p>
        <p className="text-[13px]">Thirteen in dense lists.</p>
        <p className="text-xs text-muted-foreground">Twelve for what is said once and small.</p>
        <p className="font-mono text-sm">
          DEV-42 · @planner · run.awaiting_input · 0123456789 tabular
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <MemberChip member={ada} />
        <MemberChip member={planner} showHandle sponsorName="Ada Lovelace" />
        <MemberChip member={{ ...ada, suspendedAt: new Date() }} />
        <MemberChip member={planner} size="lg" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(runStatusLabels) as RunStatusValue[]).map((status) => (
          <RunStatus key={status} status={status} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button>Approve</Button>
        <Button variant="outline">Reject</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Revoke</Button>
        <Shortcut keys="mod+k" />
        <Shortcut keys="g i" />
        <Shortcut keys="shift+a" />
      </div>
    </section>
  );
}

/** The tokens, drawn side by side in both themes, for reviewing a palette change. */
export function TokensPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Tokens</h1>
        <p className="text-sm text-muted-foreground">
          The palette and the type scale, as the browser draws them. Human, Agent and Gate are the
          only saturated colours on a screen besides the primary.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border">
          <Sheet theme="light" />
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Sheet theme="dark" />
        </div>
      </div>
    </div>
  );
}

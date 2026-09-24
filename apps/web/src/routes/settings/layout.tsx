import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SettingsNavPage {
  label: string;
  to: string;
}

/**
 * The Settings area's own navigation: four groups for what were eleven flat
 * links (docs/plans/ui-redesign.md). Shared with the command palette, so a
 * page is reachable by the same name from either.
 */
export const settingsNav: Array<{ group: string; pages: SettingsNavPage[] }> = [
  {
    group: "Workspace",
    pages: [
      { label: "General", to: "/settings/workspace" },
      { label: "Members", to: "/settings/members" },
      { label: "Event log", to: "/settings/events" },
    ],
  },
  {
    group: "Work",
    pages: [
      // The tools first: a Project is a binding to one, so there is nothing to
      // configure until something is connected (ADR-0024).
      { label: "Sockets", to: "/settings/sockets" },
      { label: "Projects", to: "/settings/projects" },
    ],
  },
  {
    group: "Agents and delivery",
    pages: [
      { label: "Agents", to: "/settings/agents" },
      { label: "Channels", to: "/settings/channels" },
      { label: "Webhooks", to: "/settings/webhooks" },
    ],
  },
  {
    group: "You",
    pages: [
      { label: "Notifications", to: "/settings/notifications" },
      { label: "Identities", to: "/settings/identities" },
      { label: "MCP clients", to: "/settings/mcp-clients" },
    ],
  },
];

/**
 * The frame every Settings page sits in: a second, narrower navigation beside
 * the page. It leaves the primary sidebar alone — this nav's own border, group
 * headings and active tint already read as the second level, and folding
 * somebody's sidebar for them was a jolt on the way in and again on the way
 * out (Matt, 2026-09-07).
 */
export function SettingsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const pages = settingsNav.flatMap((group) => group.pages);
  const here = pages.find((page) => pathname === page.to || pathname.startsWith(`${page.to}/`));

  return (
    <div className="flex min-h-full">
      {/* At `lg`, not `md`: this nav is 235px and the primary sidebar beside it
          is 256, so at 768 the page itself was left 161px and every second
          Settings page pushed the window sideways. Below that the strip below
          is the whole navigation. */}
      <nav
        aria-label="Settings"
        className="hidden w-56 shrink-0 flex-col gap-5 border-r px-3 py-5 lg:flex"
      >
        {settingsNav.map(({ group, pages }) => (
          <div key={group} className="flex flex-col gap-1">
            <div className="px-2 text-xs font-medium text-muted-foreground">{group}</div>
            <ul className="flex flex-col gap-0.5">
              {pages.map((page) => {
                const active = pathname === page.to || pathname.startsWith(`${page.to}/`);
                return (
                  <li key={page.to}>
                    <Link
                      to={page.to}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center rounded-md px-2.5 text-sm hover:bg-accent",
                        active ? "bg-accent font-medium" : "text-foreground/80",
                      )}
                    >
                      {page.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {/* No padding of its own until there is a nav beside it to be padded from:
          the shell already gives the page a 24px gutter, and a second one under
          it spent 100px of a 390px screen on margins (Matt, 2026-09-07). */}
      <div className="flex min-w-0 flex-1 flex-col lg:p-6">
        {/* Below lg the nav beside is gone. Not the eleven as a strip that
            scrolls sideways: MCP clients was four swipes from General, and the
            page you were on could be scrolled off its own navigation. One
            control instead — it names where you are without being opened, opens
            to the whole list in the four groups the wide nav uses, and costs one
            row (Matt, 2026-09-07). */}
        <nav aria-label="Settings pages" className="mb-6 lg:hidden">
          <Select
            value={here?.to ?? null}
            onValueChange={(next) => {
              if (next) void navigate({ to: next });
            }}
          >
            <SelectTrigger aria-label="Settings page" className="w-full">
              <SelectValue>
                {(chosen: string | null) =>
                  pages.find((page) => page.to === chosen)?.label ?? "Settings"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {settingsNav.map(({ group, pages: inGroup }) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {inGroup.map((page) => (
                    <SelectItem key={page.to} value={page.to}>
                      {page.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </nav>
        {/* A container, so a page lays itself out by the room it actually has:
            behind the sidebar and this nav, a viewport breakpoint says nothing
            about the width a form on it gets (routes/issues/issue.tsx does the
            same). Pages use `@sm:`…`@3xl:`, never `sm:`…`xl:`. */}
        <div className="@container mx-auto flex w-full max-w-[1100px] flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

import { Link, Outlet, useMatches, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  ChevronsUpDown,
  ClipboardList,
  Inbox,
  LogOut,
  Monitor,
  Moon,
  PlayCircle,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { Shortcut } from "@/components/kbd-hint";
import { MemberChip } from "@/components/member-chip";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  sidebarMenuButtonVariants,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth";
import { useLiveEvents } from "@/lib/live";
import { orpc } from "@/lib/orpc";
import { useShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export interface ShellProps {
  workspaceName: string;
  memberName: string;
  /** The signed-in Member, for the chip in the footer. Absent, the name alone is shown. */
  member?: {
    id: string;
    kind: "human" | "agent";
    handle: string | null;
    role: "admin" | "member";
    image: string | null;
  };
}

/**
 * The frame every signed-in page sits in (docs/plans/ui-redesign.md, slice 1):
 * a sidebar that folds to its icons, with the Inbox as its only badge, the
 * Projects listed rather than hidden behind a page, and Settings as a door to
 * its own area; the command palette on ⌘K; and the page, full width.
 */
export function AppShell({ workspaceName, memberName, member }: ShellProps) {
  // Mounted once for the whole signed-in app, so one stream serves every page.
  useLiveEvents(true);
  const navigate = useNavigate();
  // A page that lays out its own panes (the Inbox) opts out of the shell's padding.
  const bleed = useMatches().some((match) => match.staticData.bleed === true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useShortcut("mod+k", () => setPaletteOpen((open) => !open), { global: true });
  // Global, so `?` closes the sheet too: while open it owns the shortcut scope.
  useShortcut("?", () => setShortcutsOpen((open) => !open), { global: true });
  useShortcut("g i", () => void navigate({ to: "/inbox" }));
  useShortcut("g r", () => void navigate({ to: "/runs" }));
  useShortcut("g w", () => void navigate({ to: "/work" }));
  useShortcut("g p", () => void navigate({ to: "/settings/projects" }));
  useShortcut("g s", () => void navigate({ to: "/settings/workspace" }));

  const me = {
    id: member?.id ?? "me",
    kind: member?.kind ?? ("human" as const),
    handle: member?.handle ?? null,
    user: { name: memberName, image: member?.image ?? null },
  };

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip={workspaceName}
                render={<Link to="/" />}
                // Folded, `size="lg"` sets `p-0`, which left-aligns the size-6
                // badge in a size-8 box: 4px off the column every other icon
                // keeps. Centre it there and the rail reads as one column.
                className="font-semibold group-data-[collapsible=icon]:justify-center"
              >
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs text-primary-foreground"
                >
                  {workspaceName.slice(0, 1).toUpperCase()}
                </span>
                {/* Gone when folded, gap and all: left in, its `gap-2` alone is
                      the 4px that pushed the badge off the rail's centre line. */}
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  {workspaceName}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Search or jump" onClick={() => setPaletteOpen(true)}>
                <Search />
                <span className="text-muted-foreground">Search or jump…</span>
                <Shortcut keys="mod+k" className="ml-auto" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Needs me" render={<Link to="/" />}>
                    <BellRing />
                    <span>Needs me</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Inbox" render={<Link to="/inbox" />}>
                    <Inbox />
                    <span>Inbox</span>
                  </SidebarMenuButton>
                  <InboxBadge />
                </SidebarMenuItem>
                {/* What the Agents are doing, and the records they are doing
                    it on. Everything else a team reads in its own tools. */}
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Runs" render={<Link to="/runs" />}>
                    <PlayCircle />
                    <span>Runs</span>
                    <Shortcut keys="g r" className="ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Work" render={<Link to="/work" />}>
                    <ClipboardList />
                    <span>Work</span>
                    <Shortcut keys="g w" className="ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" render={<Link to="/settings/workspace" />}>
                <Settings />
                <span>Settings</span>
                <Shortcut keys="g s" className="ml-auto" />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <MemberMenu me={me} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <AppBreadcrumb />
          <span className="flex-1" />
        </div>
        {/*
         * SidebarInset is the <main>; this is the page inside it, and it is
         * what scrolls. The frame is exactly the viewport's height (below),
         * so the sidebar and the top bar stay put and a screen that asks for
         * `h-full` — the Board, whose columns scroll on their own — gets the
         * room that is actually there rather than growing the window.
         */}
        <div
          className={cn(
            "min-w-0 flex-1 overflow-y-auto",
            bleed ? "flex min-h-0 flex-col" : "flex flex-col p-6",
          )}
        >
          <Outlet />
        </div>
      </SidebarInset>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Toaster />
    </SidebarProvider>
  );
}

/** The unread count, live: useLiveEvents re-reads the inbox on every Event that could owe one. */
function InboxBadge() {
  const unread = useQuery(orpc.inbox.unreadCount.queryOptions({ input: {} }));
  const count = unread.data?.unread ?? 0;
  if (count === 0) return null;
  return (
    <SidebarMenuBadge
      aria-label={`${String(count)} unread`}
      // A count, not an alarm: quiet grey that reads on the row's rest, hover and active tints.
      className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium text-foreground/75 tabular-nums"
    >
      {count}
    </SidebarMenuBadge>
  );
}

function MemberMenu({
  me,
}: {
  me: {
    id: string;
    kind: "human" | "agent";
    handle: string | null;
    user: { name: string; image: string | null };
  };
}) {
  const { theme, setTheme } = useTheme();
  // Folded to icons, the trigger is the avatar alone.
  const folded = useSidebar().state === "collapsed";
  return (
    <DropdownMenu>
      {/* The trigger is the button itself, dressed as a sidebar item: handing a
          SidebarMenuButton to the trigger's `render` loses the click on the way
          through two render layers, and a menu that does not open is worse than
          a tooltip that is missing. */}
      <DropdownMenuTrigger
        data-slot="sidebar-menu-button"
        data-size="lg"
        aria-label={me.user.name}
        className={cn(
          sidebarMenuButtonVariants({ size: "lg" }),
          "min-w-0 group-data-[collapsible=icon]:justify-center",
          // The avatar's ring and its offset are drawn outside its box, which
          // together are the folded button's whole width; clipping is what
          // shaved the ring's left off, so folded it does not clip.
          "group-data-[collapsible=icon]:overflow-visible",
        )}
      >
        {/* Folded, the chip must not stretch: `flex-1` parks the avatar against
            the button's left edge, and `justify-center` then has nothing to move. */}
        <MemberChip
          member={me}
          size="md"
          className={cn("min-w-0", folded ? "shrink-0" : "flex-1")}
          avatarOnly={folded}
        />
        <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        {/* A Base UI menu label lives inside a group, or the menu throws as it opens. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span>{me.user.name}</span>
            {me.handle ? (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                @{me.handle}
              </span>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="system">
              <Monitor />
              System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <Sun />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon />
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => authClient.signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

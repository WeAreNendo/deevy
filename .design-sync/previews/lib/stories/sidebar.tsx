import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  MemberChip,
  PageHeader,
  Shortcut,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@deevy/design-system";
import {
  BellRing,
  ChevronsUpDown,
  ClipboardList,
  Folder,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { ada } from "../fixtures";

const workspaceName = "Acme";

/** The signed-in Member in the footer: folded to icons, the avatar alone. */
const MemberRow = () => {
  const folded = useSidebar().state === "collapsed";
  return (
    <SidebarMenuButton
      size="lg"
      tooltip={ada.user.name}
      aria-label={ada.user.name}
      className="min-w-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-visible"
    >
      <MemberChip
        member={ada}
        size="md"
        className={folded ? "min-w-0 shrink-0" : "min-w-0 flex-1"}
        avatarOnly={folded}
      />
      <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
    </SidebarMenuButton>
  );
};

/** deevy's primary sidebar, as the app's frame (routes/shell.tsx). */
const AppSidebar = () => (
  <Sidebar collapsible="icon" className="h-full">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip={workspaceName}
            className="font-semibold group-data-[collapsible=icon]:justify-center"
          >
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs text-primary-foreground"
            >
              A
            </span>
            <span className="truncate group-data-[collapsible=icon]:hidden">{workspaceName}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Search or jump">
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
              <SidebarMenuButton tooltip="Needs me">
                <BellRing />
                <span>Needs me</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Runs">
                <PlayCircle />
                <span>Runs</span>
                <Shortcut keys="g r" className="ml-auto" />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Work">
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
          <SidebarMenuButton tooltip="Settings">
            <Settings />
            <span>Settings</span>
            <Shortcut keys="g s" className="ml-auto" />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <MemberRow />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
);

/** The page beside the sidebar: the top bar with the trigger and the trail, then the page. */
const Page = () => (
  <SidebarInset>
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbPage>Home</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
      <PageHeader title="Needs me" description="Rulings, and what your Agents are doing." />
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        The page, full width
      </div>
    </div>
  </SidebarInset>
);

/**
 * The frame is the containing block: its transform keeps the fixed sidebar
 * inside the card, and its height stands in for the viewport's.
 */
const Frame = ({ defaultOpen, children }: { defaultOpen: boolean; children: React.ReactNode }) => (
  <div className="relative h-[520px] w-full transform-gpu overflow-hidden rounded-lg border bg-background">
    <SidebarProvider defaultOpen={defaultOpen} className="h-full min-h-0">
      {children}
    </SidebarProvider>
  </div>
);

/** The app's frame: the sidebar open, the page beside it. */
export const Expanded = () => (
  <Frame defaultOpen>
    <AppSidebar />
    <Page />
  </Frame>
);

/** Folded to its icons: the labels hide, the Member is the avatar alone. */
export const Collapsed = () => (
  <Frame defaultOpen={false}>
    <AppSidebar />
    <Page />
  </Frame>
);

/** The parts the frame does not use, on a sidebar that does not fold: a field, a group's label and action, a sub-menu, a row's action, a count, a group still loading. The words are of no product. */
export const EveryPart = () => (
  <div className="h-[520px] w-fit overflow-hidden rounded-lg border">
    <SidebarProvider className="h-full min-h-0 w-fit">
      <Sidebar collapsible="none" className="border-r">
        <SidebarHeader>
          <SidebarInput placeholder="Filter…" aria-label="Filter" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>A group</SidebarGroupLabel>
            <SidebarGroupAction aria-label="Add">
              <Plus />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <Folder />
                    <span>First</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="More">
                    <MoreHorizontal />
                  </SidebarMenuAction>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>
                        <span>One</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>
                        <span>Two</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Folder />
                    <span>Second</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="tabular-nums">3</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Loading</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {[1, 2, 3].map((row) => (
                  <SidebarMenuItem key={row}>
                    <SidebarMenuSkeleton
                      showIcon
                      className="[&_[data-slot=skeleton]]:bg-sidebar-foreground/10"
                    />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  </div>
);

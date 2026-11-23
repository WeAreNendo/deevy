import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  Button,
  MemberChip,
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
  FolderKanban,
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
      className="min-w-0 group-data-[collapsible=icon]:justify-center"
    >
      <MemberChip member={ada} size="md" className="min-w-0 flex-1" avatarOnly={folded} />
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
              <SidebarMenuButton tooltip="Needs me" isActive>
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
            <BreadcrumbPage>Needs me</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <span className="flex-1" />
      <Button variant="outline" size="sm">
        Search <Shortcut keys="mod+k" />
      </Button>
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
      <h1 className="font-display text-xl font-semibold tracking-tight">Needs me</h1>
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

/** Folded to its icons: labels and badges hide, the Member is the avatar alone. */
export const Collapsed = () => (
  <Frame defaultOpen={false}>
    <AppSidebar />
    <Page />
  </Frame>
);

/** A sidebar that does not fold, with the parts the frame does not use: search, sub-menus, actions, a count, a loading group. */
export const StandaloneWithSubmenus = () => (
  <div className="h-[520px] w-fit overflow-hidden rounded-lg border">
    <SidebarProvider className="h-full min-h-0 w-fit">
      <Sidebar collapsible="none" className="border-r">
        <SidebarHeader>
          <SidebarInput placeholder="Filter Projects…" aria-label="Filter Projects" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction aria-label="Bind a Project">
              <Plus />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <FolderKanban />
                    <span>deevy</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="More">
                    <MoreHorizontal />
                  </SidebarMenuAction>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>
                        <span>Binding</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>
                        <span>Checkpoints</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>
                        <span>Agents</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <FolderKanban />
                    <span>Operations</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge
                    aria-label="3 Runs working"
                    className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium text-foreground/75 tabular-nums"
                  >
                    3
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Agents</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton
                    showIcon
                    className="[&_[data-slot=skeleton]]:bg-sidebar-foreground/10"
                  />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton
                    showIcon
                    className="[&_[data-slot=skeleton]]:bg-sidebar-foreground/10"
                  />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton
                    showIcon
                    className="[&_[data-slot=skeleton]]:bg-sidebar-foreground/10"
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  </div>
);

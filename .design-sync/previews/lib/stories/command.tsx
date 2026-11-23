import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@deevy/design-system";
import {
  BellRing,
  ClipboardList,
  FolderKanban,
  Keyboard,
  PlayCircle,
  Settings,
} from "lucide-react";

const settingsPages = [
  { group: "Workspace", label: "General" },
  { group: "Workspace", label: "Members" },
  { group: "Workspace", label: "Event log" },
  { group: "Work", label: "Sockets" },
  { group: "Work", label: "Projects" },
  { group: "Agents and delivery", label: "Agents" },
  { group: "Agents and delivery", label: "Webhooks" },
];

/** ⌘K: everywhere by name from one box, each Settings page with its group. Open so the card shows it. */
export const Palette = () => (
  <CommandDialog open title="Jump to" description="Jump to a page">
    <Command>
      <CommandInput placeholder="Jump to…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem value="needs me">
            <BellRing />
            Needs me
          </CommandItem>
          <CommandItem value="runs">
            <PlayCircle />
            Runs
            <CommandShortcut>g r</CommandShortcut>
          </CommandItem>
          <CommandItem value="work">
            <ClipboardList />
            Work
            <CommandShortcut>g w</CommandShortcut>
          </CommandItem>
          <CommandItem value="projects">
            <FolderKanban />
            Projects
            <CommandShortcut>g p</CommandShortcut>
          </CommandItem>
          <CommandItem value="settings">
            <Settings />
            Settings
            <CommandShortcut>g s</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          {settingsPages.map((page) => (
            <CommandItem key={page.label} value={`${page.group} ${page.label} settings`}>
              <Settings />
              {page.label}
              <span className="ml-auto text-xs text-muted-foreground">{page.group}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Help">
          <CommandItem value="keyboard shortcuts">
            <Keyboard />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  </CommandDialog>
);

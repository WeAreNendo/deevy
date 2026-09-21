import { useNavigate } from "@tanstack/react-router";
import { FolderKanban, Inbox, Keyboard, Settings } from "lucide-react";
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
} from "@/components/ui/command";
import { useShortcutScope } from "@/lib/shortcuts";
import { settingsNav } from "@/routes/settings/layout";

/**
 * ⌘K: everywhere in deevy by name, from one box (docs/plans/ui-redesign.md).
 * Searching for work is not here any more — the records live in a tracker and
 * are searched there (ADR-0024); what this jumps to is deevy's own pages.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts?: () => void;
}) {
  const navigate = useNavigate();
  // While it is open the page behind it is quiet, so `g i` typed into the
  // search box searches instead of jumping.
  useShortcutScope("palette", open);

  const close = () => onOpenChange(false);
  // Every destination here is a route the router knows; the cast is what lets
  // one list of strings stand in for a dozen literal types.
  const goTo = (to: string) => {
    close();
    void navigate({ to: to as "/" });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Jump to"
      description="Jump to a page"
    >
      {/* This CommandDialog puts its children straight into the dialog; the cmdk root is ours to add. */}
      <Command>
        <CommandInput placeholder="Jump to…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => goTo("/inbox")}>
              <Inbox />
              Inbox
              <CommandShortcut>g i</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => goTo("/settings/projects")}>
              <FolderKanban />
              Projects
              <CommandShortcut>g p</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => goTo("/settings/workspace")}>
              <Settings />
              Settings
              <CommandShortcut>g s</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Settings">
            {settingsNav.flatMap(({ group, pages }) =>
              pages.map((page) => (
                <CommandItem
                  key={page.to}
                  value={`${group} ${page.label} settings`}
                  onSelect={() => goTo(page.to)}
                >
                  <Settings />
                  {page.label}
                  <span className="ml-auto text-xs text-muted-foreground">{group}</span>
                </CommandItem>
              )),
            )}
          </CommandGroup>
          {onShowShortcuts ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Help">
                <CommandItem
                  onSelect={() => {
                    close();
                    onShowShortcuts();
                  }}
                >
                  <Keyboard />
                  Keyboard shortcuts
                  <CommandShortcut>?</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

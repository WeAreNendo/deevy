import { Shortcut } from "@/components/kbd-hint";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useShortcutScope } from "@/lib/shortcuts";

/** The keyboard, as one table — the same one .claude/skills/deevy-ui carries. */
const groups: Array<{ title: string; rows: Array<[keys: string, does: string]> }> = [
  {
    title: "Anywhere",
    rows: [
      ["mod+k", "Jump to a page, a Run or a record"],
      ["?", "This sheet"],
      ["mod+b", "Fold the sidebar"],
      ["g i", "Inbox"],
      ["g r", "Runs"],
      ["g w", "Work"],
      ["g p", "Projects"],
      ["g s", "Settings"],
    ],
  },
  {
    title: "In a list",
    rows: [
      ["j", "Next row"],
      ["k", "Previous row"],
      ["enter", "Open it"],
      ["escape", "Clear the selection, or close what is open"],
    ],
  },
  {
    title: "On a Gate",
    rows: [
      ["shift+a", "Approve: the Note, with Approve chosen for ⌘↵"],
      ["shift+r", "Reject: the same, with Reject chosen"],
      ["mod+enter", "Commit the ruling"],
    ],
  },
  {
    title: "In the Inbox",
    rows: [
      ["e", "Mark the selected Notification read"],
      ["shift+e", "Mark everything read"],
    ],
  },
  {
    title: "While writing",
    rows: [
      ["mod+enter", "Send the answer or the note"],
      ["@", "Mention a Member"],
    ],
  },
];

/** `?` opens it: every shortcut on one sheet, so none has to be remembered. */
export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useShortcutScope("shortcuts", open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto p-0 text-sm">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>Keyboard</SheetTitle>
          <SheetDescription>
            Letters are ignored while you type; a key with ⌘ or Ctrl is not.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-5 py-4">
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              <dl className="flex flex-col gap-1.5">
                {group.rows.map(([keys, does]) => (
                  <div key={keys} className="flex items-center justify-between gap-4">
                    <dt className="text-foreground/90">{does}</dt>
                    <dd>
                      <Shortcut keys={keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  MemberChip,
} from "@deevy/design-system";
import { ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, MoreHorizontal, Sun } from "lucide-react";
import { ada, grace, omar } from "../fixtures";

/** The Member menu at the foot of the sidebar: who you are, the theme, the way out. Open so the card shows it. */
export const MemberMenu = () => (
  <div className="flex min-h-80 items-start">
    <DropdownMenu open>
      <DropdownMenuTrigger render={<Button variant="ghost" className="w-56 justify-start" />}>
        <MemberChip member={ada} size="md" className="min-w-0 flex-1" />
        <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span>Ada Lovelace</span>
            <span className="font-mono text-xs font-normal text-muted-foreground">@ada</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="system">
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
        <DropdownMenuItem>
          <Keyboard />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

/** An Agent's row menu: its Projects as checkboxes, its Sponsor in a submenu (open too), the one destructive item last. */
export const AgentMenu = () => (
  <div className="flex min-h-80 items-start">
    <DropdownMenu open>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="More for Builder" />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-mono">@builder</DropdownMenuLabel>
          <DropdownMenuItem>
            Copy handle
            <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Open its Runs
            <DropdownMenuShortcut>↵</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked className="font-mono">
            acme/deevy
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked className="font-mono">
            acme/ops
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem className="font-mono">acme/site</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>Change Sponsor</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {[ada, grace, omar].map((human) => (
              <DropdownMenuItem key={human.id}>
                <MemberChip member={human} size="xs" />
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Revoke acme/ops</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MemberChip,
} from "@deevy/design-system";
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { ada } from "../fixtures";

/** The Member menu at the foot of the sidebar, deevy's one menu: who you are, the theme, the way out. Open so the card shows it. */
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
          <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
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
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

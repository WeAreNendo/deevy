import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@deevy/design-system";

/** The parts deevy's one menu does not use: an item's shortcut, items that tick, a submenu (open too), a destructive item last. The words are of no product. */
export const EveryPart = () => (
  <div className="flex min-h-80 items-start">
    <DropdownMenu open>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>A heading</DropdownMenuLabel>
          <DropdownMenuItem>
            An item
            <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem checked>Ticked</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Not ticked</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>A submenu</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>One</DropdownMenuItem>
            <DropdownMenuItem>Two</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

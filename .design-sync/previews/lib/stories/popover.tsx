import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  MemberChip,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@deevy/design-system";
import { ChevronDown } from "lucide-react";
import { ada, grace, omar } from "../fixtures";

/** An Agent's Sponsor: the Humans in a Popover under the current one, open so the card shows it. */
export const SponsorPicker = () => (
  <div className="flex min-h-80 items-start">
    <Popover open>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <MemberChip member={ada} size="xs" />
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command label="Sponsor">
          <CommandInput placeholder="Change Sponsor…" />
          <CommandList>
            <CommandEmpty>No Human by that name.</CommandEmpty>
            <CommandGroup heading="Humans">
              {[ada, grace, omar].map((human) => (
                <CommandItem
                  key={human.id}
                  value={human.user.name}
                  data-checked={human === ada ? "true" : undefined}
                >
                  <MemberChip member={human} size="xs" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>
);

/** A header with a title and description, above plain content: who may rule at a Checkpoint. */
export const WithHeader = () => (
  <div className="flex min-h-56 items-start">
    <Popover open>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        Who may rule at ship?
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>ship takes 2 approvals</PopoverTitle>
          <PopoverDescription>
            A Run waits here until two of Ada Lovelace, Grace Hopper and Omar Haddad approve the
            Proposal, and never the Human the work is for. An Agent never rules.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm">
            Later
          </Button>
          <Button size="sm">Open the Gate</Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);

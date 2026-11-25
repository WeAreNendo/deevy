import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@deevy/design-system";

// No screen uses a Popover: a choice is a Select or a Combobox, a form is a
// Dialog. The words are of no product.

/** A header with a title and a line under it, then a field and its action. Open so the card shows it. */
export const WithHeader = () => (
  <div className="flex min-h-64 items-start">
    <Popover open>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>Open</PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>A title</PopoverTitle>
          <PopoverDescription>A line on what this is for.</PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="popover-value">Value</Label>
          <Input id="popover-value" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button size="sm">Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);

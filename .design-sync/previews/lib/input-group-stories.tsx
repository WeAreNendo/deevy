import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Label,
} from "@deevy/design-system";
import { Copy, Link2, Search, X } from "lucide-react";

// No screen composes an InputGroup (the palette's search and Combobox carry
// their own inside the kit), so these show the parts in words of no product.

/** An icon before the field, a count after it. */
export const IconAndText = () => (
  <div className="w-full max-w-sm">
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search…" aria-label="Search" />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="tabular-nums">12 results</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

/** A fixed prefix that is not up for editing, and a button at the end. */
export const Prefix = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="ig-address">Address</Label>
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput id="ig-address" defaultValue="example.com" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy">
          <Copy />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

/** A textarea with a row under it, in the same frame. */
export const TextareaWithFooter = () => (
  <div className="w-full max-w-sm">
    <InputGroup>
      <InputGroupTextarea rows={3} placeholder="Write something…" aria-label="Text" />
      <InputGroupAddon align="block-end">
        <InputGroupText className="tabular-nums">0 of 280</InputGroupText>
        <InputGroupButton className="ml-auto" variant="default" size="sm">
          Save
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

/** A filled value with a clear button; an invalid group paints its whole frame. */
export const ClearAndInvalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <InputGroup>
      <InputGroupInput defaultValue="A value" aria-label="Text" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Clear">
          <X />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <InputGroup>
      <InputGroupAddon>
        <Link2 />
      </InputGroupAddon>
      <InputGroupInput defaultValue="not an address" aria-invalid aria-label="Address" />
    </InputGroup>
  </div>
);

/** A heading above the control, and an action in the same frame. */
export const BlockStart = () => (
  <div className="w-full max-w-sm">
    <InputGroup>
      <InputGroupAddon align="block-start" className="border-b">
        <InputGroupText>Title</InputGroupText>
        <InputGroupButton size="xs" className="ml-auto">
          Reset
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupInput defaultValue="A value" aria-label="Title" />
    </InputGroup>
  </div>
);

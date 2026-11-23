import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Kbd,
  Label,
} from "@deevy/design-system";
import { Check, Copy, Link2, Search, X } from "lucide-react";

/** A search with the shortcut that opens it at the end. */
export const SearchWithShortcut = () => (
  <div className="w-full max-w-sm">
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="A key or a word of the title…" aria-label="Search Work" />
      <InputGroupAddon align="inline-end">
        <Kbd>/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

/** A fixed prefix: the scheme is not up for editing. */
export const UrlPrefix = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="ig-webhook">Webhook URL</Label>
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput id="ig-webhook" defaultValue="agent.example.com/deevy" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy">
          <Copy />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

/** A textarea with the ruling below it: the Note on a Gate, and Approve. */
export const NoteWithApprove = () => (
  <div className="w-full max-w-sm">
    <InputGroup>
      <InputGroupTextarea
        rows={3}
        placeholder="Why, in a sentence. Optional on an approval."
        aria-label="Note"
      />
      <InputGroupAddon align="block-end">
        <InputGroupText>
          <Kbd>⌘↵</Kbd> commits
        </InputGroupText>
        <InputGroupButton className="ml-auto" variant="default" size="sm">
          Approve <Check data-icon="inline-end" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

/** A filled value with a clear button; an invalid group paints its whole frame. */
export const ClearAndInvalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <InputGroup>
      <InputGroupInput defaultValue="cursor paging" aria-label="Search Work" />
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
      <InputGroupInput defaultValue="not a url" aria-invalid aria-label="Webhook URL" />
    </InputGroup>
  </div>
);

/** A heading above the control, and an action in the same frame. */
export const BlockStart = () => (
  <div className="w-full max-w-sm">
    <InputGroup>
      <InputGroupAddon align="block-start" className="border-b">
        <InputGroupText>Signing secret</InputGroupText>
        <Button variant="ghost" size="xs" className="ml-auto" type="button">
          Generate
        </Button>
      </InputGroupAddon>
      <InputGroupInput
        readOnly
        defaultValue="whsec_7Hq2…Lm4x"
        className="font-mono"
        aria-label="Signing secret"
      />
    </InputGroup>
  </div>
);

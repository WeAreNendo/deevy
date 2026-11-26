import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@deevy/design-system";

// No screen picks several at once (who may rule is Checkboxes), so the chips
// use words of no product.
const fruit = ["Apple", "Cherry", "Grape", "Orange"];

/** Several choices as chips, one box to add more, open: the list hangs from the whole box. */
export const Chips = () => {
  const anchor = useComboboxAnchor();
  return (
    <div className="flex h-56 w-80 flex-col">
      <Combobox multiple defaultOpen items={fruit} defaultValue={["Apple", "Grape"]}>
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(picked: string[]) =>
              picked.map((name) => (
                <ComboboxChip key={name} removeLabel={`Remove ${name}`}>
                  {name}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput aria-label="Fruit" placeholder="Add…" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Nothing matches.</ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name}>
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};

/**
 * Chips that cannot be changed: the box goes muted, the chips dim. The chip's
 * own `has-disabled:` never fires (Base UI's ChipRemove is
 * focusable-when-disabled, so it carries aria-disabled), hence the
 * `data-disabled:` classes here; the chips box has no disabled state.
 */
export const ChipsDisabled = () => {
  const anchor = useComboboxAnchor();
  return (
    <div className="w-80">
      <Combobox multiple disabled items={fruit} defaultValue={["Apple"]}>
        <ComboboxChips ref={anchor} className="cursor-not-allowed bg-muted opacity-70">
          <ComboboxValue>
            {(picked: string[]) =>
              picked.map((name) => (
                <ComboboxChip
                  key={name}
                  removeLabel={`Remove ${name}`}
                  className="data-disabled:opacity-50"
                >
                  {name}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput aria-label="Fruit" disabled />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name}>
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};

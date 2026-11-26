import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
} from "@deevy/design-system";

// No screen groups what a Combobox offers, so the groups use words of no product.
const produce = [
  { value: "Fruit", items: ["Apple", "Cherry"] },
  { value: "Vegetables", items: ["Carrot", "Leek"] },
];

/** Items under headings, with a separator between. */
export const Grouped = () => (
  <div className="flex h-64 w-64 flex-col">
    <Combobox defaultOpen items={produce} defaultValue="Cherry">
      <ComboboxInput aria-label="Produce" />
      <ComboboxContent>
        <ComboboxEmpty>Nothing matches.</ComboboxEmpty>
        <ComboboxList>
          {(group: (typeof produce)[number], index: number) => (
            <ComboboxGroup key={group.value} items={group.items}>
              {index > 0 ? <ComboboxSeparator /> : null}
              <ComboboxLabel>{group.value}</ComboboxLabel>
              <ComboboxCollection>
                {(name: string) => (
                  <ComboboxItem key={name} value={name}>
                    {name}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

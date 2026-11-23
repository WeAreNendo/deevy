import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxValue,
  MemberChip,
  useComboboxAnchor,
} from "@deevy/design-system";
import { ada, builder, grace, omar, planner } from "./fixtures";

type Member = typeof ada;

const humans: Member[] = [ada, grace, omar];
const agents: Member[] = [planner, builder];
const memberGroups = [
  { value: "Humans", items: humans },
  { value: "Agents", items: agents },
];
const projects = [
  { slug: "deevy", name: "deevy", container: "acme/deevy" },
  { slug: "ops", name: "Operations", container: "acme/ops" },
  { slug: "site", name: "Site", container: "acme/site" },
];

const byId = (a: Member, b: Member) => a.id === b.id;
const memberName = (member: Member) => member.user.name;

/** Who may rule on ship: chosen Humans as chips, one box to add more. Closed. */
export const Chips = () => {
  const anchor = useComboboxAnchor();
  return (
    <div className="w-80">
      <Combobox
        multiple
        items={humans}
        defaultValue={[ada, grace]}
        itemToStringLabel={memberName}
        isItemEqualToValue={byId}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(picked: Member[]) =>
              picked.map((human) => (
                <ComboboxChip key={human.id} removeLabel={`Remove ${human.user.name}`}>
                  <MemberChip member={human} size="xs" />
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput aria-label="Who may rule" placeholder="Add…" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No Human by that name.</ComboboxEmpty>
          <ComboboxList>
            {(human: Member) => (
              <ComboboxItem key={human.id} value={human}>
                {human.user.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};

/** The chips box open: the list is anchored to the whole box, the chosen Humans ticked. */
export const ChipsOpen = () => {
  const anchor = useComboboxAnchor();
  return (
    <div className="flex h-56 w-80 flex-col">
      <Combobox
        multiple
        defaultOpen
        items={humans}
        defaultValue={[ada]}
        itemToStringLabel={memberName}
        isItemEqualToValue={byId}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(picked: Member[]) =>
              picked.map((human) => (
                <ComboboxChip key={human.id} removeLabel={`Remove ${human.user.name}`}>
                  <MemberChip member={human} size="xs" />
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput aria-label="Who may rule" placeholder="Add…" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No Human by that name.</ComboboxEmpty>
          <ComboboxList>
            {(human: Member) => (
              <ComboboxItem key={human.id} value={human}>
                {human.user.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};

/** One choice typed into: a Project to grant an Agent, with the trigger chevron and a clear button. */
export const SingleInput = () => (
  <div className="w-64">
    <Combobox
      items={projects}
      defaultValue={projects[0]}
      itemToStringLabel={(project: (typeof projects)[number]) => project.name}
      isItemEqualToValue={(a: (typeof projects)[number], b: (typeof projects)[number]) =>
        a.slug === b.slug
      }
    >
      <ComboboxInput aria-label="Grant a Project" placeholder="Choose a Project…" showClear />
      <ComboboxContent>
        <ComboboxEmpty>No Project matches.</ComboboxEmpty>
        <ComboboxList>
          {(project: (typeof projects)[number]) => (
            <ComboboxItem key={project.slug} value={project}>
              {project.name}
              <span className="font-mono text-muted-foreground">{project.container}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

/** Open, grouped: Members under Humans / Agents with a separator between, as a filter by who did it reads. */
export const GroupedOpen = () => (
  <div className="flex h-72 w-64 flex-col">
    <Combobox
      defaultOpen
      items={memberGroups}
      defaultValue={planner}
      itemToStringLabel={memberName}
      isItemEqualToValue={byId}
    >
      <ComboboxInput aria-label="Who did it" placeholder="Anybody…" />
      <ComboboxContent>
        <ComboboxEmpty>No Member by that name.</ComboboxEmpty>
        <ComboboxList>
          {(group: (typeof memberGroups)[number], index: number) => (
            <ComboboxGroup key={group.value} items={group.items}>
              {index > 0 ? <ComboboxSeparator /> : null}
              <ComboboxLabel>{group.value}</ComboboxLabel>
              <ComboboxCollection>
                {(member: Member) => (
                  <ComboboxItem key={member.id} value={member}>
                    <MemberChip member={member} size="xs" />
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

/** Typed past every item: the empty message takes the list's place. */
export const NoMatch = () => (
  <div className="flex h-32 w-64 flex-col">
    <Combobox
      defaultOpen
      items={projects}
      defaultInputValue="Billing"
      itemToStringLabel={(project: (typeof projects)[number]) => project.name}
    >
      <ComboboxInput aria-label="Grant a Project" placeholder="Choose a Project…" />
      <ComboboxContent>
        <ComboboxEmpty>No Project matches.</ComboboxEmpty>
        <ComboboxList>
          {(project: (typeof projects)[number]) => (
            <ComboboxItem key={project.slug} value={project}>
              {project.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

/**
 * While the change is saving, the whole picker is disabled: the box goes muted, the chips dim.
 * The chip's own `has-disabled:` never fires (Base UI's ChipRemove is focusable-when-disabled, so it
 * carries aria-disabled), hence the `data-disabled:` classes here; the chips box has no disabled state.
 */
export const Disabled = () => {
  const anchor = useComboboxAnchor();
  return (
    <div className="w-80">
      <Combobox
        multiple
        disabled
        items={humans}
        defaultValue={[grace]}
        itemToStringLabel={memberName}
        isItemEqualToValue={byId}
      >
        <ComboboxChips ref={anchor} className="cursor-not-allowed bg-muted opacity-70">
          <ComboboxValue>
            {(picked: Member[]) =>
              picked.map((human) => (
                <ComboboxChip
                  key={human.id}
                  removeLabel={`Remove ${human.user.name}`}
                  className="data-disabled:opacity-50"
                >
                  <MemberChip member={human} size="xs" />
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput aria-label="Who may rule" placeholder="Saving…" disabled />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxList>
            {(human: Member) => (
              <ComboboxItem key={human.id} value={human}>
                {human.user.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};

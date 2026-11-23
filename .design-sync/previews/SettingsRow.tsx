import {
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@deevy/design-system";

/**
 * A Project's binding as rows: one setting each, the label and its hint on the
 * left, the control on the right once the column is wide enough.
 */
export const Binding = () => (
  <div className="@container max-w-3xl">
    <SettingsSection title="Binding" aria-label="Binding">
      <div className="flex flex-col">
        <SettingsRow
          label="Default Agent"
          hint="Gets every record routed to this Project, and is granted the Project."
        >
          <Select defaultValue="planner">
            <SelectTrigger aria-label="Default Agent" className="w-48">
              <SelectValue>
                {(value: string) => (value === "planner" ? "Planner" : "Builder")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Agents</SelectLabel>
                <SelectItem value="planner">Planner</SelectItem>
                <SelectItem value="builder">Builder</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Routing label"
          hint="A record carrying this label in the tracker is routed here."
          htmlFor="routing-label"
        >
          <Input id="routing-label" defaultValue="deevy" className="w-48 font-mono" />
        </SettingsRow>
        <SettingsRow
          label="Route by mention"
          hint="Mentioning an Agent on a record routes it to that Agent."
          htmlFor="route-by-mention"
        >
          <Switch id="route-by-mention" defaultChecked />
        </SettingsRow>
        <SettingsRow
          label="Base branch"
          hint="Where an Agent's work starts from."
          htmlFor="base-branch"
        >
          <Input id="base-branch" defaultValue="main" className="w-48 font-mono" />
        </SettingsRow>
      </div>
    </SettingsSection>
  </div>
);

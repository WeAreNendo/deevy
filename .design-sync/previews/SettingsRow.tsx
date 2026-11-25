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
          hint="Who gets an open record no label and no mention named."
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
          hint="A record labelled agent:planner goes to that Agent."
          htmlFor="routing-label"
        >
          <Input id="routing-label" defaultValue="agent:" className="w-48 font-mono" />
        </SettingsRow>
        <SettingsRow
          label="Route by mention"
          hint="A comment such as @deevy planner hands the record to that Agent."
          htmlFor="route-by-mention"
        >
          <Switch id="route-by-mention" defaultChecked />
        </SettingsRow>
      </div>
    </SettingsSection>
  </div>
);

import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  Input,
  Switch,
  Textarea,
} from "@deevy/design-system";

/** Label, control, description: the unit every deevy form is built from. */
export const Default = () => (
  <Field className="max-w-sm">
    <FieldLabel htmlFor="field-name">Name</FieldLabel>
    <Input id="field-name" defaultValue="deevy" />
    <FieldDescription>
      What this Project is called in deevy. Its records keep their tracker&apos;s keys, like{" "}
      <span className="font-mono">acme/deevy#412</span>.
    </FieldDescription>
  </Field>
);

/** `data-invalid` turns the Field's text destructive; FieldError carries the message. */
export const Invalid = () => (
  <Field className="max-w-sm" data-invalid>
    <FieldLabel htmlFor="field-webhook">Webhook URL</FieldLabel>
    <Input id="field-webhook" defaultValue="http://agent.example.com/" aria-invalid />
    <FieldError>It must be https.</FieldError>
  </Field>
);

/** Several messages fold into a list. */
export const Errors = () => (
  <Field className="max-w-sm" data-invalid>
    <FieldLabel htmlFor="field-handle">Handle</FieldLabel>
    <Input id="field-handle" defaultValue="Planner Agent" aria-invalid />
    <FieldError
      errors={[
        { message: "Lowercase letters, digits and dashes only." },
        { message: "Another Member already uses this handle." },
      ]}
    />
  </Field>
);

/** Horizontal: the control leads, the words follow. A Checkbox or a Switch reads this way. */
export const Horizontal = () => (
  <div className="flex max-w-sm flex-col gap-4">
    <Field orientation="horizontal">
      <Checkbox id="field-exclude" defaultChecked />
      <FieldContent>
        <FieldLabel htmlFor="field-exclude">Not the Human the work is for</FieldLabel>
        <FieldDescription>Whoever asked for the work cannot approve it here.</FieldDescription>
      </FieldContent>
    </Field>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="field-mention">Route by mention</FieldLabel>
        <FieldDescription>
          A comment such as <span className="font-mono">@deevy planner</span> hands the record to
          that Agent.
        </FieldDescription>
      </FieldContent>
      <Switch id="field-mention" />
    </Field>
  </div>
);

/** A whole form: a FieldGroup of Fields, a FieldSet with a legend, a separator, the actions. */
export const BindAProject = () => (
  <form className="w-full max-w-md" onSubmit={(submitted) => submitted.preventDefault()}>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="bp-name">Name</FieldLabel>
        <Input id="bp-name" placeholder="deevy" />
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="bp-container">Container</FieldLabel>
        <Input id="bp-container" defaultValue="acme/deevy" aria-invalid className="font-mono" />
        <FieldError>Another Project is already bound to this container.</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor="bp-description">Description</FieldLabel>
        <Textarea id="bp-description" rows={3} placeholder="What this Project is for." />
        <FieldDescription>Markdown, for whoever opens the Project next.</FieldDescription>
      </Field>
      <FieldSeparator>Who works here</FieldSeparator>
      <FieldSet>
        <FieldLegend>Agents</FieldLegend>
        <FieldDescription>
          The Agents that may see this Project&apos;s records. The Default Agent always can.
        </FieldDescription>
        <Field orientation="horizontal">
          <Checkbox id="bp-planner" defaultChecked />
          <FieldLabel htmlFor="bp-planner">Planner</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="bp-reviewer" />
          <FieldLabel htmlFor="bp-reviewer">Reviewer</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="bp-builder" defaultChecked />
          <FieldContent>
            <FieldLabel htmlFor="bp-builder">Builder</FieldLabel>
            <FieldDescription>An Agent; Ada Lovelace sponsors it.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldSet>
      <Field orientation="horizontal" className="justify-end">
        <Button variant="ghost" type="button">
          Cancel
        </Button>
        <Button type="submit">Bind it</Button>
      </Field>
    </FieldGroup>
  </form>
);

/** A FieldLabel that wraps a Field becomes a selectable card; `FieldTitle` is the small heading inside. */
export const Choice = () => (
  <FieldGroup className="max-w-sm">
    <FieldLabel htmlFor="choice-any">
      <Field orientation="horizontal">
        <Checkbox id="choice-any" defaultChecked />
        <FieldContent>
          <FieldTitle>Any Human may rule</FieldTitle>
          <FieldDescription>None named means every active Human.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
    <FieldLabel htmlFor="choice-named">
      <Field orientation="horizontal">
        <Checkbox id="choice-named" />
        <FieldContent>
          <FieldTitle>Only named Humans</FieldTitle>
          <FieldDescription>Pick them below. An Agent never rules.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  </FieldGroup>
);

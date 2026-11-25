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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@deevy/design-system";

/** Label, control, description: the unit the connect dialogs are built from. */
export const Default = () => (
  <Field className="max-w-sm">
    <FieldLabel htmlFor="field-name">Name</FieldLabel>
    <Input id="field-name" placeholder="Acme on GitLab" />
    <FieldDescription>What this Socket is called in deevy.</FieldDescription>
  </Field>
);

/** `aria-invalid` on the control and a FieldError under it, as connecting GitHub says a login is not one. */
export const Invalid = () => (
  <Field className="max-w-sm" data-invalid>
    <FieldLabel htmlFor="field-organization">Organization</FieldLabel>
    <Input id="field-organization" defaultValue="acme--inc" aria-invalid />
    <FieldError>
      GitHub gives out no such login: letters, digits and single hyphens, with no hyphen first or
      last, and no more than 39 of them.
    </FieldError>
  </Field>
);

/** Several messages fold into a list. No screen gives it more than one. */
export const Errors = () => (
  <Field className="max-w-sm" data-invalid>
    <FieldLabel htmlFor="field-text">Text</FieldLabel>
    <Input id="field-text" defaultValue="A value" aria-invalid />
    <FieldError errors={[{ message: "The first thing wrong." }, { message: "And the second." }]} />
  </Field>
);

/** Horizontal: the control leads, or the words do. No screen lays a Field out this way. */
export const Horizontal = () => (
  <div className="flex max-w-sm flex-col gap-4">
    <Field orientation="horizontal">
      <Checkbox id="field-leads" defaultChecked />
      <FieldLabel htmlFor="field-leads">The control leads</FieldLabel>
    </Field>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="field-trails">The words lead</FieldLabel>
        <FieldDescription>With a line under them.</FieldDescription>
      </FieldContent>
      <Switch id="field-trails" defaultChecked />
    </Field>
  </div>
);

const socketName = (selected: string) =>
  selected === "sock_4k9m2q7x1z3c" ? "acme on GitHub (GitHub)" : "Which tool";

/** A whole form, with the fields and the words of Bind a Project: a tool, a container in it, a name. */
export const BindAProject = () => (
  <form className="w-full max-w-md" onSubmit={(submitted) => submitted.preventDefault()}>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="bp-tool">Tool</FieldLabel>
        <Select defaultValue="sock_4k9m2q7x1z3c">
          <SelectTrigger id="bp-tool" aria-label="Tool">
            <SelectValue>{socketName}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="sock_4k9m2q7x1z3c">acme on GitHub (GitHub)</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="bp-container">Container</FieldLabel>
        <Select defaultValue="acme/deevy">
          <SelectTrigger id="bp-container" aria-label="Container">
            <SelectValue placeholder="Which container" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="acme/deevy">acme/deevy</SelectItem>
              <SelectItem value="acme/ops">acme/ops</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          What the tool itself offers. One container is one Project.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="bp-name">Name</FieldLabel>
        <Input id="bp-name" defaultValue="deevy" placeholder="deevy" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button">
          Cancel
        </Button>
        <Button type="submit">Bind it</Button>
      </div>
    </FieldGroup>
  </form>
);

/** A FieldSet and its legend, over a FieldGroup. No screen uses them: who may rule at a Checkpoint is Checkbox's own card. */
export const FieldsetAndLegend = () => (
  <FieldSet className="max-w-sm">
    <FieldLegend variant="label">A set of choices</FieldLegend>
    <FieldGroup className="gap-3">
      <Field orientation="horizontal">
        <Checkbox id="set-one" defaultChecked />
        <FieldLabel htmlFor="set-one">One</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="set-two" />
        <FieldLabel htmlFor="set-two">Two</FieldLabel>
      </Field>
    </FieldGroup>
  </FieldSet>
);

/** Two fields ruled apart. No screen uses the separator. */
export const Separated = () => (
  <FieldGroup className="max-w-sm">
    <Field>
      <FieldLabel htmlFor="separated-one">One</FieldLabel>
      <Input id="separated-one" />
    </Field>
    <FieldSeparator />
    <Field>
      <FieldLabel htmlFor="separated-two">Two</FieldLabel>
      <Input id="separated-two" />
    </Field>
  </FieldGroup>
);

/** A FieldLabel that wraps a Field becomes a selectable card; `FieldTitle` is the small heading inside. No screen uses one. */
export const Choice = () => (
  <FieldGroup className="max-w-sm">
    <FieldLabel htmlFor="choice-one">
      <Field orientation="horizontal">
        <Checkbox id="choice-one" defaultChecked />
        <FieldContent>
          <FieldTitle>The first choice</FieldTitle>
          <FieldDescription>A line on what it does.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
    <FieldLabel htmlFor="choice-two">
      <Field orientation="horizontal">
        <Checkbox id="choice-two" />
        <FieldContent>
          <FieldTitle>The second choice</FieldTitle>
          <FieldDescription>And a line on this one.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  </FieldGroup>
);

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Label,
} from "@deevy/design-system";
import { ada, grace, omar, type Member } from "./fixtures";

const humans: Member[] = [ada, grace, omar];

interface Project {
  id: string;
  slug: string;
  name: string;
}
const projects: Project[] = [
  { id: "proj_4k9m2q7x1z3c", slug: "acme-deevy", name: "deevy" },
  { id: "proj_7d2f5g8h1j4k", slug: "acme-ops", name: "Operations" },
  { id: "proj_0p3r6t9v2x5z", slug: "acme-site", name: "Site" },
];
const projectLabel = (project: Project) => `${project.slug} — ${project.name}`;
const sameId = (a: { id: string }, b: { id: string }) => a.id === b.id;

/** An Agent's Sponsor, on its page: one Human, typed into, the current one shown. */
export const ChangeSponsor = () => (
  <div className="flex flex-col gap-1">
    <Label htmlFor="agent-sponsor" className="text-xs text-muted-foreground">
      Sponsor
    </Label>
    <Combobox
      items={humans}
      defaultValue={ada}
      itemToStringLabel={(human: Member) => human.user.name}
      isItemEqualToValue={sameId}
    >
      <ComboboxInput id="agent-sponsor" aria-label="Change Sponsor" className="w-56" />
      <ComboboxContent>
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

/** Granting an Agent a Project, open: the slug in mono, then the name. Choosing one grants it. */
export const GrantAProject = () => (
  <div className="flex h-48 flex-col gap-2">
    <Label htmlFor="grant-project">Grant a Project</Label>
    <Combobox
      defaultOpen
      items={projects}
      itemToStringLabel={projectLabel}
      isItemEqualToValue={sameId}
    >
      <ComboboxInput id="grant-project" className="w-72" placeholder="Choose a Project…" />
      <ComboboxContent>
        <ComboboxEmpty>No Project matches.</ComboboxEmpty>
        <ComboboxList>
          {(project: Project) => (
            <ComboboxItem key={project.id} value={project}>
              <span className="font-mono text-xs text-muted-foreground">{project.slug}</span>
              {project.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

/** Typed past every item: the empty message takes the list's place. */
export const NoMatch = () => (
  <div className="flex h-32 w-72 flex-col">
    <Combobox
      defaultOpen
      items={projects}
      defaultInputValue="Billing"
      itemToStringLabel={projectLabel}
    >
      <ComboboxInput aria-label="Grant a Project" placeholder="Choose a Project…" />
      <ComboboxContent>
        <ComboboxEmpty>No Project matches.</ComboboxEmpty>
        <ComboboxList>
          {(project: Project) => (
            <ComboboxItem key={project.id} value={project}>
              {project.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

/** Nothing left to choose: disabled, and the placeholder says why. */
export const Disabled = () => (
  <div className="flex flex-col gap-2">
    <Label htmlFor="grant-none">Grant a Project</Label>
    <Combobox items={[] as Project[]} disabled itemToStringLabel={projectLabel}>
      <ComboboxInput id="grant-none" className="w-72" placeholder="Every Project is granted" />
      <ComboboxContent>
        <ComboboxList>
          {(project: Project) => (
            <ComboboxItem key={project.id} value={project}>
              {project.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

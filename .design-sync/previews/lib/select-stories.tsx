import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@deevy/design-system";
import { ada, builder, grace, planner } from "./fixtures";

const humans = [ada, grace];
const agents = [planner, builder];
const ANY = "__any";

const routedToName = (selected: string) => {
  if (selected === ANY) return "Anybody";
  if (selected === "me") return "Me";
  if (selected === "agents:me") return "My Agents";
  if (selected === "nobody") return "Nobody";
  return [...humans, ...agents].find((member) => member.id === selected)?.user.name ?? selected;
};

/** The Routed to filter's list: the shortcuts, then Members as names under Humans / Agents. */
const RoutedToItems = () => (
  <>
    <SelectGroup>
      <SelectItem value={ANY}>Anybody</SelectItem>
      <SelectItem value="me">Me</SelectItem>
      <SelectItem value="agents:me">My Agents</SelectItem>
      <SelectItem value="nobody">Nobody</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Humans</SelectLabel>
      {humans.map((member) => (
        <SelectItem key={member.id} value={member.id}>
          {member.user.name}
        </SelectItem>
      ))}
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Agents</SelectLabel>
      {agents.map((member) => (
        <SelectItem key={member.id} value={member.id}>
          {member.user.name}
        </SelectItem>
      ))}
    </SelectGroup>
  </>
);

/** The Routed to filter with an Agent chosen, closed. */
export const RoutedTo = () => (
  <Select defaultValue={planner.id}>
    <SelectTrigger aria-label="Routed to" className="w-44">
      <SelectValue>{routedToName}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <RoutedToItems />
    </SelectContent>
  </Select>
);

/** The same Select open: groups labelled Humans / Agents, separators between, the chosen item ticked. */
export const Open = () => (
  <div className="flex h-96 flex-col">
    <Select defaultValue={planner.id} defaultOpen>
      <SelectTrigger aria-label="Routed to" className="w-44">
        <SelectValue>{routedToName}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <RoutedToItems />
      </SelectContent>
    </Select>
  </div>
);

const mirrorLabel: Record<string, string> = {
  off: "Nothing",
  gates: "Gates and rulings",
  runs: "Runs as well",
};

/** With a Label, as a Project asks how much deevy writes back where the work lives. */
export const WithLabel = () => (
  <div className="flex flex-col gap-2">
    <Label htmlFor="project-mirror">Mirror</Label>
    <Select defaultValue="gates">
      <SelectTrigger id="project-mirror" className="w-48">
        <SelectValue>{(selected: string) => mirrorLabel[selected] ?? selected}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Object.entries(mirrorLabel).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

const kindName = (selected: string) =>
  selected === ANY ? "Every kind" : <span className="font-mono">{selected}.*</span>;

/** The two trigger heights: `sm` for a toolbar, `default` for a form. */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Select defaultValue={ANY}>
      <SelectTrigger size="sm" aria-label="Kind" className="w-36">
        <SelectValue>{kindName}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ANY}>Every kind</SelectItem>
          <SelectItem value="run" className="font-mono">
            run.*
          </SelectItem>
          <SelectItem value="gate" className="font-mono">
            gate.*
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <Select defaultValue="gate">
      <SelectTrigger aria-label="Kind" className="w-36">
        <SelectValue>{kindName}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ANY}>Every kind</SelectItem>
          <SelectItem value="run" className="font-mono">
            run.*
          </SelectItem>
          <SelectItem value="gate" className="font-mono">
            gate.*
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

const projectName = (selected: string) => (selected === "ops" ? "Operations" : "deevy");

/** Nothing chosen yet (the placeholder), and a Select that cannot be changed. */
export const PlaceholderAndDisabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Select>
      <SelectTrigger aria-label="Project" className="w-40">
        <SelectValue placeholder="Choose a Project" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="deevy">deevy</SelectItem>
          <SelectItem value="ops">Operations</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <Select defaultValue="deevy" disabled>
      <SelectTrigger aria-label="Project" className="w-40">
        <SelectValue>{projectName}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="deevy">deevy</SelectItem>
          <SelectItem value="ops">Operations</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

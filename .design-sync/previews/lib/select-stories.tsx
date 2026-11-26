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
import { builder, planner } from "./fixtures";

const agents = [planner, builder];
const ANY = "__any";
const NOBODY = "__nobody";

const agentName = (selected: string) =>
  agents.find((agent) => agent.id === selected)?.user.name ?? "Nobody";

/** A Project's Default Agent: Nobody, a separator, then the Agents under their heading. */
const DefaultAgentItems = () => (
  <>
    <SelectGroup>
      <SelectItem value={NOBODY}>Nobody</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Agents</SelectLabel>
      {agents.map((agent) => (
        <SelectItem key={agent.id} value={agent.id}>
          {agent.user.name}
        </SelectItem>
      ))}
    </SelectGroup>
  </>
);

/** With a Label, as a Project's binding has it: a Member is their name as text, never a chip. */
export const DefaultAgent = () => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="project-default-agent">Default Agent</Label>
    <Select defaultValue={planner.id}>
      <SelectTrigger id="project-default-agent" aria-label="Default Agent" className="w-72">
        <SelectValue>{agentName}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <DefaultAgentItems />
      </SelectContent>
    </Select>
  </div>
);

/** The same Select open: the "none" item first, a separator, the group and its label, the chosen item ticked. */
export const Open = () => (
  <div className="flex h-56 flex-col">
    <Select defaultValue={planner.id} defaultOpen>
      <SelectTrigger aria-label="Default Agent" className="w-72">
        <SelectValue>{agentName}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <DefaultAgentItems />
      </SelectContent>
    </Select>
  </div>
);

const routedTo: Record<string, string> = {
  [ANY]: "Anybody",
  agent: "An Agent",
  human: "A Human",
  nobody: "Nobody",
};

/** In a filter bar, with no visible Label: who deevy routed a record to, on Work. */
export const RoutedTo = () => (
  <Select defaultValue="agent">
    <SelectTrigger aria-label="Routed to" className="w-40">
      <SelectValue>{(selected: string) => routedTo[selected] ?? selected}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {Object.entries(routedTo).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
);

const kindName = (selected: string) => (selected === ANY ? "Every kind" : `${selected}.*`);

/** The two trigger heights: `sm` in a table's row (a Member's role), `default` everywhere else (the Event log's Kind). */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-4">
    <Select defaultValue="admin">
      <SelectTrigger size="sm" aria-label="Role of Ada Lovelace">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="admin">admin</SelectItem>
          <SelectItem value="member">member</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <Select defaultValue="gate">
      <SelectTrigger aria-label="Kind" className="w-44">
        <SelectValue>{kindName}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ANY}>Every kind</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Runs and Gates</SelectLabel>
          <SelectItem value="run">run.*</SelectItem>
          <SelectItem value="gate">gate.*</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

/** Nothing chosen yet, and the one that waits on it: Bind a Project before a tool is named. */
export const PlaceholderAndDisabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-4">
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="bind-socket">Tool</Label>
      <Select>
        <SelectTrigger id="bind-socket" aria-label="Tool">
          <SelectValue placeholder="Which tool" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="sock_4k9m2q7x1z3c">acme on GitHub (GitHub)</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="bind-container">Container</Label>
      <Select disabled>
        <SelectTrigger id="bind-container" aria-label="Container">
          <SelectValue placeholder="Which container" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="acme/deevy">acme/deevy</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  </div>
);

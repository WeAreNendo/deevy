import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { orpc } from "@/lib/orpc";

/** What `/work` carries in its URL. Every one of these is the server's filter. */
export interface WorkSearch {
  q?: string;
  project?: string;
  state?: "open" | "closed";
  assignee?: "human" | "agent" | "nobody";
}

/** Base UI wants a real value for "any", so the sentinel is a constant. */
const ANY = "__any";

export function parseWorkSearch(search: Record<string, unknown>): WorkSearch {
  const text = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : "");
  const state = text("state");
  const assignee = text("assignee");
  return {
    ...(text("q") ? { q: text("q") } : {}),
    ...(text("project") ? { project: text("project") } : {}),
    ...(state === "open" || state === "closed" ? { state } : {}),
    ...(assignee === "human" || assignee === "agent" || assignee === "nobody" ? { assignee } : {}),
  };
}

/**
 * The filter bar over the Work list: what the tracker says, who deevy routed
 * it to, and a word of the title. Slimmed from the Issue filters the tracker
 * took with it — there are no States, no Labels and no groupings here, because
 * those are the tracker's now (ADR-0024).
 */
export function WorkFilters({
  search,
  onSearch,
}: {
  search: WorkSearch;
  onSearch: (patch: Partial<WorkSearch>) => void;
}) {
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const [text, setText] = useState(search.q ?? "");

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        className="flex items-center gap-2"
        onSubmit={(sent) => {
          sent.preventDefault();
          onSearch({ q: text.trim() || undefined });
        }}
      >
        <Label htmlFor="work-search" className="sr-only">
          Search
        </Label>
        <Input
          id="work-search"
          value={text}
          placeholder="A key or a word of the title…"
          className="w-56"
          onChange={(changed) => setText(changed.target.value)}
        />
      </form>

      <ToggleGroup
        variant="outline"
        spacing={0}
        value={search.state ? [search.state] : []}
        onValueChange={(next) => onSearch({ state: (next as string[])[0] as WorkSearch["state"] })}
      >
        <ToggleGroupItem value="open">Open</ToggleGroupItem>
        <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
      </ToggleGroup>

      <Select
        value={search.project ?? ANY}
        onValueChange={(next) => onSearch({ project: next === ANY ? undefined : (next as string) })}
      >
        <SelectTrigger aria-label="Project" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ANY}>Any Project</SelectItem>
            {(projects.data?.projects ?? []).map((project) => (
              <SelectItem key={project.id} value={project.slug}>
                {project.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        value={search.assignee ?? ANY}
        onValueChange={(next) =>
          onSearch({ assignee: next === ANY ? undefined : (next as WorkSearch["assignee"]) })
        }
      >
        <SelectTrigger aria-label="Routed to" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ANY}>Anybody</SelectItem>
            <SelectItem value="agent">An Agent</SelectItem>
            <SelectItem value="human">A Human</SelectItem>
            <SelectItem value="nobody">Nobody</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

/** The one `issues.list` input the Work list sends, built from the URL. */
export function workListInput(search: WorkSearch) {
  return {
    limit: 100,
    ...(search.q ? { q: search.q } : {}),
    ...(search.project ? { projectSlug: search.project } : {}),
    ...(search.state ? { state: search.state } : {}),
    ...(search.assignee === "nobody" ? { unassigned: true } : {}),
    ...(search.assignee === "human" || search.assignee === "agent"
      ? { assigneeKind: search.assignee }
      : {}),
  };
}

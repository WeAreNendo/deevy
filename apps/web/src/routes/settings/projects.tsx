import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { BindProject } from "@/components/bind-project";
import { SettingsPage } from "@/components/settings-page";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { ProjectSettingsForm } from "./project-settings";

export interface ProjectsSettingsPageProps {
  /** The key of the Project being configured; `?project=` in the URL. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * How each Project is configured: its name, what it is for, the Team that owns
 * it, and archiving it. Master–detail, the shape Teams taught — a rail of every
 * Project beside the one you are changing, with `?project=` naming it so a
 * Project's settings are a link and Back undoes a selection.
 *
 * It lives here because a Project is a binding rather than a place with work
 * in it (ADR-0024): what it names is the Socket its records come from, the
 * repository its code is in, and the Agents that may work it. The work itself
 * is in the tracker, which is where somebody reads it.
 */
export function ProjectsSettingsPage({ selected, onSelect }: ProjectsSettingsPageProps) {
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const [filter, setFilter] = useState("");

  const all = projects.data?.projects ?? [];
  const current = all.find((project) => project.slug === selected) ?? all[0] ?? null;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? all.filter(
        (project) =>
          project.name.toLowerCase().includes(needle) ||
          project.slug.toLowerCase().includes(needle),
      )
    : all;

  return (
    <SettingsPage title="Projects" actions={<BindProject onBound={onSelect} />}>
      {projects.isError ? (
        <p className="text-sm text-destructive">{projects.error.message}</p>
      ) : null}
      {projects.isPending ? <p className="text-muted-foreground">Loading Projects…</p> : null}

      {!projects.isPending && all.length === 0 ? (
        <div className="flex flex-1 flex-col gap-4">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderKanban aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No Projects yet</EmptyTitle>
              <EmptyDescription>
                A Project binds a container in one of your tools to the Agents that work it. Connect
                a tool under Sockets, then bind one of its containers here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : null}

      {current ? (
        // Stacked until the column is wide enough for two panes, as Teams is.
        <div className="grid gap-5 @2xl:grid-cols-[15rem_minmax(0,1fr)]">
          <nav
            aria-label="Projects"
            className="flex flex-col gap-2 @2xl:border-r @2xl:pr-4 @2xl:pb-2"
          >
            {/* A filter is furniture until there are enough Projects to lose one in. */}
            {all.length > 5 ? (
              <Input
                aria-label="Filter Projects"
                value={filter}
                placeholder="Filter Projects…"
                onChange={(changed) => setFilter(changed.target.value)}
              />
            ) : null}

            <ul className="flex flex-col gap-0.5">
              {shown.map((project) => {
                const active = project.slug === current.slug;
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => onSelect(project.slug)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
                        active && "bg-accent",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("truncate text-sm", active && "font-medium")}>
                          {project.name}
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {project.slug}
                        </span>
                      </span>
                      {project.archivedAt ? (
                        <Badge variant="outline" className="shrink-0">
                          Archived
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <article aria-label={current.name} className="flex flex-col gap-5">
            <ProjectSettingsForm projectSlug={current.slug} />
          </article>
        </div>
      ) : null}
    </SettingsPage>
  );
}

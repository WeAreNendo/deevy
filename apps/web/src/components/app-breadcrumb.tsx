import { Fragment } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { orpc } from "@/lib/orpc";
import { settingsNav } from "@/routes/settings/layout";

export interface Crumb {
  label: string;
  /** Where the crumb leads; the last crumb has none, it is where you are. */
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}

const projectTabs: Record<string, string> = {
  board: "Board",
  workflow: "Workflow",
  settings: "Settings",
};

/** What the trail can name instead of an id or a key: Projects, and Members on their detail pages. */
export interface CrumbNames {
  project: (key: string) => string | undefined;
  member?: (id: string) => string | undefined;
}

/**
 * The trail for a URL, in CONTEXT.md's words: where you are, and the places
 * above it you can go back to. A pure function of the path and the search, so
 * a test can read it without a router; the names come from the caller.
 */
export function crumbsFor(
  pathname: string,
  search: Record<string, unknown>,
  names: CrumbNames,
): Crumb[] {
  const projectName = names.project;
  const parts = pathname.split("/").filter(Boolean);
  const [head, second, third] = parts;

  if (parts.length === 0) {
    const label =
      search.assignee === "me"
        ? "My Issues"
        : search.assignee === "agents:me"
          ? "My Agents' Issues"
          : "All Issues";
    return search.view === "board" ? [{ label, to: "/" }, { label: "Board" }] : [{ label }];
  }
  if (head === "inbox") return [{ label: "Inbox" }];
  if (head === "projects") {
    const projects: Crumb = { label: "Projects", to: "/projects" };
    if (!second) return [projects];
    const project: Crumb = {
      label: projectName(second) ?? second,
      to: "/projects/$key",
      params: { key: second },
    };
    if (!third) return [projects, project];
    return [projects, project, { label: projectTabs[third] ?? third }];
  }
  if (head === "issues" && second) {
    const key = second.split("-")[0] ?? second;
    return [
      { label: "Projects", to: "/projects" },
      { label: projectName(key) ?? key, to: "/projects/$key", params: { key } },
      { label: second },
    ];
  }
  if (head === "settings") {
    const settings: Crumb = { label: "Settings", to: "/settings/workspace" };
    const pages = settingsNav.flatMap((group) => group.pages);
    const page = pages
      .filter((candidate) => pathname === candidate.to || pathname.startsWith(`${candidate.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0];
    if (!page) return [settings];
    if (pathname === page.to) return [settings, { label: page.label }];
    // Below a page: an Agent's or a Member's detail is named, never its id.
    const tail = parts.at(-1) ?? "";
    const named =
      page.to === "/settings/agents" || page.to === "/settings/members"
        ? names.member?.(tail)
        : undefined;
    return [settings, { label: page.label, to: page.to }, { label: named ?? labelOf(tail) }];
  }
  return parts.map((part, index) =>
    index === parts.length - 1
      ? { label: labelOf(part) }
      : { label: labelOf(part), to: `/${parts.slice(0, index + 1).join("/")}` },
  );
}

function labelOf(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/** The top bar's breadcrumb: where you are in the Workspace, each step above it a link. */
export function AppBreadcrumb() {
  const { pathname, search, nowhere } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      search: state.location.search as Record<string, unknown>,
      // A URL no route claims leaves only the root matched (every page is a route
      // under it), and the path would only spell itself back, capitalised.
      nowhere: state.matches.length === 1,
    }),
  });
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const crumbs: Crumb[] = nowhere
    ? [{ label: "Not found" }]
    : crumbsFor(pathname, search, {
        project: (key) => projects.data?.projects.find((project) => project.slug === key)?.name,
        member: (id) => members.data?.members.find((member) => member.id === id)?.user.name,
      });

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          // The separator is an <li> of its own, a sibling of the item: shadcn's
          // shape, and the only one HTML allows (an <li> may not hold an <li>).
          return (
            <Fragment key={`${crumb.label}-${String(index)}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className="min-w-0">
                {last || !crumb.to ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="truncate"
                    render={
                      <Link
                        to={crumb.to as "/"}
                        {...(crumb.params ? { params: crumb.params as never } : {})}
                        {...(crumb.search ? { search: crumb.search as never } : {})}
                      />
                    }
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

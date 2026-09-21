import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createMemoryHistory,
  redirect,
} from "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The page owns its padding and height — the Inbox's two panes — so the shell adds none. */
    bleed?: boolean;
  }
}
import { dropInvitation } from "./lib/invitation.ts";
import { HomePage } from "./routes/home.tsx";
import { ConsentPage } from "./routes/consent.tsx";
import { TokensPage } from "./routes/dev/tokens.tsx";
import { InboxPage, parseInboxSearch } from "./routes/inbox.tsx";
import { NotFoundPage } from "./routes/not-found.tsx";
import { ProjectsSettingsPage } from "./routes/settings/projects.tsx";
import { ChannelsPage } from "./routes/settings/channels.tsx";
import { EventLogPage } from "./routes/settings/events.tsx";
import { SettingsLayout } from "./routes/settings/layout.tsx";
import { NotificationsPage } from "./routes/settings/notifications.tsx";
import { WebhooksPage } from "./routes/settings/webhooks.tsx";
import { WorkspacePage } from "./routes/settings/workspace.tsx";
import { McpClientsPage } from "./routes/settings/mcp-clients.tsx";
import { MembersPage } from "./routes/settings/members.tsx";
import { AgentsPage } from "./routes/settings/agents.tsx";
import { AgentPage } from "./routes/settings/agent.tsx";
import { AppShell, type ShellProps } from "./routes/shell.tsx";

/**
 * Routes are declared in code rather than by file convention, so every page is
 * a plain exported component the SPA tests can render on its own.
 */
const rootRoute = createRootRouteWithContext<ShellProps>()({
  component: function Root() {
    return <AppShell {...rootRoute.useRouteContext()} />;
  },
  // A URL no route claims renders inside the shell, not as the router's bare <p>.
  notFoundComponent: () => <NotFoundPage />,
});

// Home is what needs you. The Issue list and the board went with the tracker
// (ADR-0024); what a Human opens deevy for is a Gate and a Run.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
// A Project is a binding now, not a place with Issues in it, so both of its
// old URLs land where that binding is edited and links in the wild keep working.
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  beforeLoad: () => {
    throw redirect({ to: "/settings/projects" });
  },
});
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$key",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/settings/projects", search: { project: params.key } });
  },
});
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  staticData: { bleed: true },
  validateSearch: (search: Record<string, unknown>) => parseInboxSearch(search),
  component: function InboxRoute() {
    const search = inboxRoute.useSearch();
    const navigate = inboxRoute.useNavigate();
    return (
      <InboxPage
        search={search}
        onSearch={(patch) =>
          void navigate({ search: (previous) => parseInboxSearch({ ...previous, ...patch }) })
        }
      />
    );
  },
});
// The Settings area: one layout route with its own navigation, and the pages
// as its children so `/settings/<page>` keeps every URL it had.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
});
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/workspace" });
  },
});
// Each declared with its literal path, so the router's types know every `to`.
const workspaceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "workspace",
  component: WorkspacePage,
});
// Teams and Labels were deevy's own; a tracker's are its own (ADR-0024). Both
// URLs land where what replaced them is, so links in the wild keep working.
const teamsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "teams",
  beforeLoad: () => {
    throw redirect({ to: "/settings/members" });
  },
});
const projectsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "projects",
  // `?project=` names the Project being configured, and is where a link to the
  // old `/projects/<slug>` lands.
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.project === "string" && search.project ? { project: search.project } : {},
  component: function ProjectsSettings() {
    const { project } = projectsSettingsRoute.useSearch();
    const navigate = projectsSettingsRoute.useNavigate();
    return (
      <ProjectsSettingsPage
        selected={project ?? null}
        onSelect={(next) => void navigate({ search: () => (next ? { project: next } : {}) })}
      />
    );
  },
});
const labelsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "labels",
  beforeLoad: () => {
    throw redirect({ to: "/settings/projects" });
  },
});
const membersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "members",
  component: MembersPage,
});
const agentsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "agents",
  component: AgentsPage,
});
const channelsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "channels",
  component: ChannelsPage,
});
const webhooksRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "webhooks",
  component: WebhooksPage,
});
const notificationsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "notifications",
  component: NotificationsPage,
});
// The Allowlist is a section of Workspace › General since 2026-09-07; the path
// it had for a year stays, as a redirect, so a bookmark still lands on it.
const allowlistRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "allowlist",
  beforeLoad: () => {
    throw redirect({ to: "/settings/workspace" });
  },
});
const mcpClientsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "mcp-clients",
  component: McpClientsPage,
});
const eventLogRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "events",
  component: EventLogPage,
});
const agentRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "agents/$memberId",
  component: function AgentRoute() {
    return <AgentPage memberId={agentRoute.useParams().memberId} />;
  },
});

// An invitation link is answered by App.tsx, which is mounted for a Human who
// is not a Member yet; the router only exists once somebody is one. So a
// Member who lands on `/invite/<token>` is already in — the link has nothing
// left to do, and home is where they were going.
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  beforeLoad: () => {
    dropInvitation();
    throw redirect({ to: "/" });
  },
});
// Where the OAuth provider sends a Human mid-authorization (packages/core/src/auth.ts).
const consentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/consent",
  component: ConsentPage,
});
// The design tokens, drawn: a page for reviewing the palette and the type
// scale in both themes. Not linked from anywhere; a developer knows the URL.
const tokensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/tokens",
  component: TokensPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsRoute,
  inboxRoute,
  projectRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    workspaceRoute,
    teamsRoute,
    projectsSettingsRoute,
    labelsRoute,
    membersRoute,
    agentsRoute,
    agentRoute,
    channelsRoute,
    webhooksRoute,
    notificationsRoute,
    allowlistRoute,
    mcpClientsRoute,
    eventLogRoute,
  ]),
  inviteRoute,
  consentRoute,
  tokensRoute,
]);

/** `?a=b&c=d` to `{ a: "b", c: "d" }`: strings, whatever they look like. */
function parseSearch(searchStr: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(searchStr));
}

/**
 * The reverse; a key whose value is undefined is left out, which is how a
 * filter is cleared. A number or a boolean is written as its text; an object
 * would be a bug in the caller, so it is written as JSON rather than "[object Object]".
 */
function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value as string));
  }
  const out = params.toString();
  return out ? `?${out}` : "";
}

export interface AppRouterOptions {
  /** Tests drive the routes without a browser URL bar. */
  memory?: boolean;
  initialEntries?: string[];
}

export function createAppRouter(context: ShellProps, options: AppRouterOptions = {}) {
  const memory = options.memory || options.initialEntries !== undefined;
  return createRouter({
    routeTree,
    context,
    // Every search value deevy writes is a string, and stays one both ways. The
    // default serialisation is JSON, which quotes a string that would parse as
    // a number so it survives the round trip — `?open=%220%22`, shown as
    // `open="0"` — and its decoder turns a raw `?open=0` into the number 0.
    parseSearch: parseSearch,
    stringifySearch: stringifySearch,
    ...(memory
      ? { history: createMemoryHistory({ initialEntries: options.initialEntries ?? ["/"] }) }
      : {}),
  });
}

export type AppRouterInstance = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouterInstance;
  }
}

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";

/**
 * docs.deevy.dev: Starlight, built to static files and served by a Worker's
 * static assets (wrangler.jsonc). Its pages are written for the site in
 * content/, for a team on deevy Cloud and for whoever hosts deevy
 * (docs/plans/docs.md); scripts/sync.ts copies them into the content directory
 * and writes the API document below before Astro starts, so both are generated
 * and ignored by git.
 *
 * Nothing on these pages loads from anywhere but this origin: no analytics, no
 * third-party script, and the typefaces are the app's own, self-hosted from
 * @fontsource through @deevy/design (and the landing hero's Geist, through
 * @fontsource too), whose tokens dress the site as the app
 * (src/styles/theme.css, docs/plans/design-system.md). Astro's `security.csp` was tried on
 * 2026-10-09 and left off: with Starlight 0.42 the policy it wrote still
 * blocked five inline scripts on a content page, and a data: font the search
 * dialog loads, so it needs more than switching on.
 */
export default defineConfig({
  site: "https://docs.deevy.dev",
  // The port the preview launcher hands over (.claude/launch.json), as the SPA's vite.config does.
  server: { port: Number(process.env.PORT) || 4321 },
  integrations: [
    starlight({
      title: "deevy",
      description:
        "The glue between a team's tools and its Agents: the work stays in GitHub, Linear, GitLab or Notion, and deevy routes it to Agents, records their Runs, and holds the Gates only a Human may rule on.",
      favicon: "/favicon.svg",
      // The logo drawn from @deevy/design's data in the theme's colours, at the app's size,
      // and the landing's hero: its title over the workflow graph, animated.
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        Hero: "./src/components/Hero.astro",
      },
      social: [
        { icon: "github", label: "deevy on GitHub", href: "https://github.com/WeAreNendo/deevy" },
      ],
      // Each page names its own file in content/ (scripts/sync.ts), so this is only the fallback.
      editLink: { baseUrl: "https://github.com/WeAreNendo/deevy/edit/main/apps/docs/" },
      customCss: ["@deevy/design/tokens.css", "./src/styles/theme.css"],
      // Code blocks with the app's corners, hairline and faces.
      expressiveCode: {
        styleOverrides: {
          borderRadius: "var(--radius)",
          borderColor: "var(--border)",
          codeFontFamily: "var(--face-mono)",
          uiFontFamily: "var(--face-sans)",
        },
      },
      plugins: [
        // Fails the build on a link to a page or a heading that does not exist.
        // Links to localhost are what self-hosting is about, so those stand.
        // The API reference is routes the OpenAPI plugin injects rather
        // than content, which the validator cannot see, so a link into it is
        // taken on trust; the sync wrote those pages from the same document.
        starlightLinksValidator({ errorOnLocalLinks: false, exclude: ["/api/", "/api/**"] }),
        starlightOpenAPI([
          {
            base: "api",
            schema: "./.generated/openapi.json",
            sidebar: {
              label: "API reference",
              collapsed: true,
              operations: { badges: true, labels: "operationId" },
              tags: { sort: "alphabetical" },
            },
          },
        ]),
      ],
      // The plan's map (docs/plans/docs.md): deevy Cloud first, what both read in
      // the middle, self-hosting and the reference after. Each group is a
      // directory of content/, ordered by each page's own `sidebar.order`.
      sidebar: [
        { label: "Get started", items: [{ autogenerate: { directory: "get-started" } }] },
        {
          label: "Using deevy",
          items: [
            {
              label: "How deevy works",
              collapsed: true,
              items: [{ autogenerate: { directory: "concepts" } }],
            },
            {
              label: "Connect your tools",
              collapsed: true,
              items: [{ autogenerate: { directory: "tools" } }],
            },
            {
              label: "Agents",
              collapsed: true,
              items: [{ autogenerate: { directory: "agents" } }],
            },
            { label: "Gates", collapsed: true, items: [{ autogenerate: { directory: "gates" } }] },
            {
              label: "Notifications and email",
              collapsed: true,
              items: [{ autogenerate: { directory: "notifications" } }],
            },
            {
              label: "MCP and the CLI",
              collapsed: true,
              items: [{ autogenerate: { directory: "mcp-and-cli" } }],
            },
            { label: "Webhooks", slug: "webhooks" },
          ],
        },
        {
          label: "deevy Cloud",
          collapsed: true,
          items: [{ autogenerate: { directory: "cloud" } }],
        },
        {
          label: "Self-hosting",
          collapsed: true,
          items: [{ autogenerate: { directory: "self-hosting" } }],
        },
        {
          label: "Reference",
          collapsed: true,
          items: [{ autogenerate: { directory: "reference" } }],
        },
        ...openAPISidebarGroups,
      ],
    }),
  ],
});

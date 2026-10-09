import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";

/**
 * docs.deevy.dev: Starlight, built to static files and served by a Worker's
 * static assets (wrangler.jsonc). Every page but the landing is written by
 * scripts/sync.ts from the repository's own Markdown before Astro starts, so
 * the content directory and the API document below are generated and ignored
 * by git.
 *
 * Nothing on these pages loads from anywhere but this origin: no analytics, no
 * third-party script, and the two typefaces are the app's own, self-hosted
 * from @fontsource like the SPA does it. Astro's `security.csp` was tried on
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
      social: [
        { icon: "github", label: "deevy on GitHub", href: "https://github.com/WeAreNendo/deevy" },
      ],
      // Each page names the file it came from (scripts/sync.ts), so this is only the fallback.
      editLink: { baseUrl: "https://github.com/WeAreNendo/deevy/edit/main/" },
      customCss: [
        "@fontsource-variable/inter/wght.css",
        "@fontsource-variable/jetbrains-mono/wght.css",
        "./src/styles/theme.css",
      ],
      plugins: [
        // Fails the build on a link to a page or a heading that does not exist.
        // Links to localhost are what the development pages are about, so those
        // stand. The API reference is routes the OpenAPI plugin injects rather
        // than content, which the validator cannot see, so a link into it is
        // taken on trust; the sync wrote those pages from the same document.
        starlightLinksValidator({ errorOnLocalLinks: false, exclude: ["/api/", "/api/**"] }),
        starlightOpenAPI([
          {
            base: "api",
            schema: "./.generated/openapi.json",
            sidebar: {
              label: "API reference",
              operations: { badges: true, labels: "operationId" },
              tags: { sort: "alphabetical" },
            },
          },
        ]),
      ],
      // Each group is a directory the sync writes, ordered by the order it gives each page.
      sidebar: [
        { label: "Running deevy", items: [{ autogenerate: { directory: "running" } }] },
        { label: "Worked examples", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Glossary", slug: "glossary" },
        ...openAPISidebarGroups,
        {
          label: "Design decisions",
          collapsed: true,
          items: [{ autogenerate: { directory: "decisions" } }],
        },
        {
          label: "Developing deevy",
          collapsed: true,
          items: [{ autogenerate: { directory: "developing" } }],
        },
      ],
    }),
  ],
});

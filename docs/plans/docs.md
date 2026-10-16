# Docs for the people who read them

docs.deevy.dev published the repository's own Markdown: OPERATIONS.md cut into pages, every ADR, the
development guide and CONTEXT.md. That is documentation written by and for the people building deevy, and
it read that way to the two kinds of reader the site is for. A team on deevy Cloud met environment
variables, release mechanics and the hosted Worker's internals before learning how to connect GitHub; a
team hosting deevy met the same pages with what it needed spread among them.

Decided with Matt, 2026-10-16:

| Question               | Decision                                                                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape                  | One site, docs.deevy.dev, with two paths: deevy Cloud (where it opens) and Self-hosting. What both use — connecting tools, Agents, Gates, notifications — is written once, and says where the two differ.                                                                               |
| Internal documentation | Stays in this repository as Markdown and is not published: `docs/PLAN.md`, `docs/plans`, `docs/adr`, `docs/research`, `docs/DEVELOPMENT.md`, `docs/OPERATIONS.md` and the acceptance walks. Operating deevy Cloud stays in WeAreNendo/deevy-cloud (`docs/SETUP.md`, `docs/RUNBOOK.md`). |
| Writing                | Every public page is written for its reader, task first, with facts taken from the code and OPERATIONS.md rather than its sentences.                                                                                                                                                    |
| Language               | English.                                                                                                                                                                                                                                                                                |

## What is published

```
/                          what deevy is; two doors: deevy Cloud, self-hosting
/get-started/              deevy Cloud, from nothing to a first Run
  ask-for-a-workspace, sign-in, invite-your-team, connect-a-tool, add-an-agent
/concepts/                 how deevy works: Workspace, Humans and Agents, Sockets and Projects,
                           Issues, Runs, Gates and Rulings, Events
/tools/                    one page per tool: GitHub, Linear, GitLab, Notion, Slack
/agents/                   adding an Agent and its key, the reference runtime, your own harness,
                           what an Agent may do
/gates/                    how a Gate asks, more than one Human, ruling from the tracker or Slack
/notifications/            the inbox, Channels, email to a Human and to a team
/mcp-and-cli/              a Human's own MCP client (Claude Code, Cursor, VS Code), the CLI
/webhooks/
/cloud/                    the beta, where data lives, daily limits, exporting, leaving, deleting, support
/self-hosting/             requirements, the Docker image, Cloudflare Workers, configuration, sign-in
                           providers, email, a path or a proxy, upgrading, backups, health,
                           bringing a Workspace from deevy Cloud
/reference/                environment variables, the CLI, the glossary
/api/                      generated from packages/core/openapi.json
```

## How it is built

The pages are written by hand in `apps/docs/content` and are the only copy of what they say. The sync
copies them into Starlight's content directory and writes the API reference from the OpenAPI snapshot,
and nothing else: no file in `docs/` is published, and a public page links to one only through GitHub,
and only where the reader would want the reasoning. The link validator still fails the build on a link to
a page or heading that does not exist.

OPERATIONS.md stays the complete account of how deevy runs, which the code's comments point into. A
change that alters what a team or a self-hoster sees updates the public page that says it too
(CLAUDE.md).

## Writing the pages

- **The reader.** A page under `/get-started/` and `/cloud/` speaks to a team on deevy Cloud, who never
  sees a server: no environment variable, no file path, no deploy. A page under `/self-hosting/` speaks
  to whoever runs deevy and may name every variable. A page both read says where the two differ in an
  aside titled **deevy Cloud** or **Self-hosted**, or with tabs synced on `deployment`.
- **The voice.** Second person, present tense, task first: what the reader wants to do, then how. Short
  paragraphs; headings in sentence case; no history of how deevy came to be, no ADR numbers, no internal
  names (no `appendEvent`, no `apps/hosted`).
- **The words.** CONTEXT.md's vocabulary, capitalised as it is there — Workspace, Member, Human, Agent,
  Sponsor, Socket, Project, Issue, Checkpoint, Gate, Proposal, Ruling, Identity, Run, Event — and never
  the words it lists to avoid.
- **The facts.** Every one checked against the code: the screen and button names the app shows (the
  `deevy-ui` skill lists the screens), the commands the CLI takes, the variables the server reads. A
  fact that cannot be checked is left out rather than guessed.
- **The form.** Markdown, or MDX where a page uses Starlight's components; frontmatter with `title`,
  `description` and `sidebar.order`; root-relative links (`/gates/`) to pages that exist.

## Slices

1. **The site's frame**: the sync publishes only `apps/docs/content` and the API reference, the sidebar
   follows the map above, and the landing page opens the two doors.
2. **The pages**, by path: get-started and cloud; concepts, gates, notifications and webhooks;
   tools, agents and mcp-and-cli; self-hosting and the reference. Written in parallel, each from the code.
3. **Reading it whole**: one voice across the pages, every link resolving, the build passing, and the
   site walked in the browser as each reader would.

## What it found

Written on 2026-10-16, 53 pages by four writers in parallel from the shared rules above, each checking
its facts in the code. Where OPERATIONS.md and the code disagreed, the pages say what the code does, and
these are the disagreements, each still to be settled on the code's side or OPERATIONS.md's:

- **An Agent's own webhook is sent every Event of the Workspace**, Projects it is not granted included:
  `setAgentWebhook` saves the subscription with no kind and no Project, and delivery never scopes by
  Member. Proposed as its own change (scope it to the Agent's grants); webhooks.md says what it does today.
- **The GitHub App deevy creates is the person's own**: the manifest goes to `github.com/settings/apps/new`
  with `public: false`, and a private App installs only on its owner's account, so the guided path
  dead-ends for an organization's repositories. tools/github.md and get-started/connect-a-tool.md give the
  way that works (an organization owner makes the App, **Paste an App you already have**); OPERATIONS.md
  says the flow makes the App "in your organization", which it does not. Proposed as its own change.
- **The Human the work is for, excluded from a Checkpoint, may neither approve nor reject** in the code
  (`recordRuling`, `rulingRefusal`), where ADR-0020 and OPERATIONS.md say they may still reject. The pages
  follow the code until Matt decides which is meant.
- **No message says a Gate was left short by a suspension**, which OPERATIONS.md describes; the pages only
  say an admin reinstates the Member or lowers **Approvals**.
- **A webhook's retries never reach OPERATIONS.md's six-hour cap**: eight attempts from ten seconds,
  doubling, wait at most 640 seconds. The pages leave the cap out.
- **An OpenID Connect provider unreachable at startup still shows its button**, and signing in with it
  fails until deevy restarts; OPERATIONS.md says the button is not offered.
- **deevy Cloud's export tells people to load the dump with `sqlite3`**, skipping `import.mjs`, which drops
  the sign-in tokens tied to the hosted address and checks `DEEVY_SECRET`. self-hosting/from-deevy-cloud.md
  uses the import script; the console's text should too (WeAreNendo/deevy-cloud).
- **The repository's `docker-compose.yml` had no `DEEVY_SECRET`**, and OPERATIONS.md's `docker run`
  generated both secrets inline, so a new container signed everybody out and lost every Socket's
  credentials. Settled: the compose file asks for `DEEVY_SECRET` the way it asks for
  `BETTER_AUTH_SECRET`, and OPERATIONS.md generates both once, as self-hosting/docker.md does.
- **apps/cli/README.md** named a flag that does not exist (`--project-key`) and four of the eleven
  commands the CLI cannot run; fixed here.
- Two jobs have no screen and are done from the CLI on the pages: setting an Agent's webhook, and rotating
  a Slack Socket's signing secret. deevy Cloud has no support address beyond `privacy@deevy.dev`;
  cloud/support.md says so, and a real one is owed.

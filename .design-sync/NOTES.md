# design-sync notes for deevy

Repo-specific facts a re-sync needs. `config.json` holds what maps to a `cfg.*` field; this file holds the rest.

## The package the converter reads

- deevy is an app, not a library, so `apps/web/design-system/` is a small private package (`@deevy/design-system`, not in the pnpm workspace) whose `index.ts` re-exports the kit: every `components/ui/*` file and deevy's standalone components that render on their own. `node apps/web/design-system/build.mjs` (`cfg.buildCmd`) writes `dist/index.js` (ES module, every bare import external, `codeSplitting: false`), `dist/index.css` + `dist/fonts/` (a second, non-library Vite build: library mode inlines fonts as base64), `dist/types/` (tsc `emitDeclarationOnly`, then `@/…` rewritten to relative paths because the sync's type reader has no alias map) and `dist/docs/` (one `.md` per export from `families.json`, with `category:` frontmatter = the picker group; a family's own `docs/<Root>.md` becomes the root's `.prompt.md` body).
- Add a component to `index.ts` AND to `families.json`; a name in neither is a `[DOCS_UNMAPPED]` and lands in "general".
- `apps/web/node_modules` is the `--node-modules` (pnpm: `@types/react` lives only there, not at the root).
- Vite here is vite-plus's rolldown build: `output.codeSplitting`, not `inlineDynamicImports`; a CSS-only `rollupOptions.input` refuses `cssCodeSplit: false`.
- Once, during the first build iterations, `apps/web/design-system/package.json` vanished (cause not found; a later build kept it). If the converter says `[ZERO_MATCH]` and reads types "from apps/web", check that file exists.
- Excluded on purpose (bound to the API or the router, so a design tool cannot render them): AppBreadcrumb, BindProject, CheckpointPolicy, CommandPalette, Connect* (the connect dialogs, ConnectGeneric among them), GateControls, ItemEvents, ProjectBinding, ProjectChat, ShortcutsSheet, WorkFilters. ConnectAgent renders without the API but is a Settings composition, not a building block. Nothing outside `components/ui` is vendored since the board went (Sockets milestone), so there is no reui/diceui group and no `componentSrcMap`.
- JSDoc text containing `@handle` is cut at the `@` by the prop extractor; `cfg.dtsPropsFor` carries hand-written bodies for MemberChip and DataTable so the helper types (`ChipMember`, `DataColumn`) are inlined for the design agent.
- The groups (`families.json`): Actions, Forms, Overlays, Navigation, Data display, Members and Runs, Pages, Brand. The 2026-11 re-sync dropped "Members, States and Runs" with StateBadge, so every card under it moved.

## Tooling

- Playwright's browser cache on macOS is `~/Library/Caches/ms-playwright`, not `~/.cache`. `.ds-sync/` has esbuild, ts-morph, @types/react and playwright installed with npm.
- Run every converter command from the repo root; a `cd` in a shell command changes the cwd for the rest of it.
- Previews import from `@deevy/design-system` and `lucide-react`; shared sample data lives in `.design-sync/previews/lib/fixtures.tsx`, shaped like the seed (`apps/server/src/seed.ts`: records in `acme/deevy`, the Agents Planner and Builder, the Checkpoints `plan` and `ship`; example.com identities, never real ones). A card that shows a Run's status words reads `runStatusLabels` from the kit rather than spelling them, so it follows the app. A helper file directly in `previews/` named like a component would be compiled as one.
- Overlays render inside their card with `overrides.<Name>: {cardMode: "single", viewport: "720x560"}` and the `open` prop; wide tables use `cardMode: "column"`.

## Build order

- The stylesheet is compiled from source at `buildCmd` time and `@source`s `.design-sync/previews/`, so a preview may use any Tailwind utility — but only after the NEXT `buildCmd` run. Order on every sync: author previews → `node apps/web/design-system/build.mjs` → `package-build.mjs` → validate/capture. A class that renders unstyled in a card almost always means the DS build predates the preview (during the first run the fix was to copy `dist/index.css` over `ds-bundle/_ds_bundle.css` between waves). `styles.css` also carries an `@source inline(...)` safelist of layout utilities for the design agent's own glue.

## Preview compile speed

- `.design-sync/overrides/story-imports.mjs` (declared in `cfg.libOverrides`) is the bundled policy plus one early return: an import made from inside `node_modules` skips the resolve round-trip. Without it every preview that imports `lucide-react` (1,700 icon modules, one plugin round-trip each) takes ~30 s to compile and a full build takes over an hour; with it the 214 previews compile in about 90 s. On re-sync, diff the fork against `.ds-sync/lib/story-imports.mjs` and carry the one line forward.
- `cfg.storyImports.bundle: [".design-sync/previews/"]`: a part preview that re-exports its root (`export * from "./Dialog"`) would otherwise be shimmed to `window.Deevy` (the file's basename is an exported component) and render all 243 cells. Sub-part previews are one-line re-exports of their root's stories (`export * from "./Dialog"` or `./lib/<family>-stories`).
- `vp check --fix` reformats `.design-sync/previews/**` (oxfmt) and a reformatted preview changes its source hash, which clears that component's grade until it is recaptured. Run `vp check --fix` BEFORE the final capture pass, not after. Lint ignores `.design-sync/**` (root `vite.config.ts`).
- A shell `for` loop that quotes its list creates a preview named `A B C.tsx`; the build reports it as `(stale preview: A B C — component no longer exported)`. Delete it.

## Kit quirks the previews work around (candidates for a fix under apps/web)

- A disabled `Combobox` never dims its chips: `ComboboxChip` uses `has-disabled:opacity-50`, but Base UI's `ChipRemove` is `focusableWhenDisabled` and carries `aria-disabled`, not `disabled`. The `Disabled` story adds `data-disabled:opacity-50` itself.
- `Checkbox` has no indeterminate glyph; `InputGroup` is `h-7` while every other control is `h-8`; `Textarea`'s `rows` is a no-op under `field-sizing-content`.
- `Toaster`: the kit does not export `toast`, so `apps/web/design-system/index.ts` re-exports sonner's — a preview (or a design) must call the bundle's own `toast()` or the Toaster never hears it.
- `ResizablePanelGroup` is `h-full`; a vertical group needs a sized wrapper or it collapses.
- `Sidebar` hides itself below 768px (`hidden md:block` + `useIsMobile`); its stories pin a 520px-high `transform-gpu` box and `h-full` so the fixed sidebar stays inside the card.
- Open `Select` / `Combobox` popups stay inside a grid cell when the story wraps them in a fixed-height flex spacer; no single-card override was needed.

## Known render warns

- `[RENDER_THIN] ... rendered height is 0px` on 30 cards: every `Dialog`, `AlertDialog` and `Sheet` card, roots and parts. Their content is `position: fixed`, so the measured root is 0 tall while the screenshot shows the whole dialog. Checked in `_screenshots/overlays__Dialog.png` and its siblings. Not a defect; expect the same 30 lines on every sync.
- `[GRID_OVERFLOW] ... stories position content outside their cells (Collapsed, Expanded) (fixed/portal)` on the 23 Sidebar cards. The sidebar is `position: fixed` inside the story's `transform-gpu` frame, which keeps it in the card; the screenshot (`_screenshots/navigation__Sidebar.png`) shows both frames whole. The check suggests `cardMode: "single"`, which would keep one story of three. Flagged the same way in 2026-09; not a defect.
- The 2026-09 check was `243/243 previews render cleanly`; the 2026-11 re-sync's was `221/221`, `bad` 0, with the 30 thin lines and the 23 Sidebar lines above as its only warnings.

## Re-sync of 2026-11

The kit had not been synced since mattallty/deevy#28 (2026-09), so it still showed the tracker deevy was before the Sockets milestone and docs/plans/simplify.md: StateBadge, LabelBadge, IssueFilters, StateFields, ApproversPicker, MarkdownEditor, Kanban, Sortable and Timeline, sky for a Human, and sample copy of Issues with States, Labels, a Board, Documents, a Workflow and an Inbox. That re-sync:

- dropped those components' cards, docs, overrides and `dtsPropsFor` bodies, and added DeevyLogo, DeevyMark, SignInButton (Brand), RailHeading, SettingsRow (Pages) and SecretInput (Forms);
- rewrote every card's sample copy to deevy as it is (Needs me, Runs, Work, Gates at Checkpoints, Settings), with fixtures shaped like the seed, and the conventions to CONTEXT.md and the deevy-ui skill;
- took `.design-sync/` out of the history in `tools/release/tests/the-record.test.ts`, so the kit is held to the same record as the rest of the tree: a card that names something simplify.md removed fails CI;
- was checked headless with the 2026-09 converter staged in `.ds-sync/` (build, validate, the screenshots of every reworked card read by eye), before the upload, which needs the `/design-sync` skill's own driver.

## Re-sync risks

- **The upload needs a login this session may not have.** The `DesignSync` tool needs design-system authorization; a headless or SDK session cannot run `/design-login` itself, so run it once from an interactive `claude` session on the machine first. Standalone Claude Design closes by 2026-12-14 and its projects move into Claude: call `get_project` before an upload, and if it returns a `notice` or a `moveState`, follow that instead of uploading to the old project. Never create a second project.

- **The fork drifts.** `.design-sync/overrides/story-imports.mjs` is a copy of the converter's lib file plus one line; a newer design-sync ships a newer lib. Diff them on every re-sync and re-apply the one `FORK:` line.
- **The kit's export list is hand-maintained.** `apps/web/design-system/index.ts` and `families.json` list the components; a new file under `components/ui/` or a new standalone component is invisible to the sync until both are updated (a `[DOCS_UNMAPPED]` line is the tell).
- **Hand-written prop bodies rot silently.** `cfg.dtsPropsFor` inlines `ChipMember` (with MemberChip's sizes) and `DataColumn` by hand. When those interfaces change in `apps/web/src/components/*.tsx`, the `.d.ts` the design agent reads keeps the old shape until the config is edited.
- **Previews mirror app compositions by hand.** `previews/lib/fixtures.tsx` and the ported compositions (the Runs and Work columns, the sidebar and top bar, the palette, an Agent's Settings page, a Project's binding rows, the sign-in card) are copies, not imports; a redesign of a screen leaves the card showing the old one. The 2026-11 re-sync found every one of them still showing the tracker deevy no longer is.
- **Grades follow source hashes.** `vp check --fix` reformatting a preview, or any change to the fork, clears grades: expect a re-read of the sheets after either. Run the formatter before the final capture.
- **What was verified:** every card by the headless render check and every authored cell by a read of its capture sheet on the absolute rubric (Styled, Complete, Plausible) — on a light theme only; the dark theme (`.dark` on `<html>`) ships in the CSS but no card was captured in it.
- **Toolchain assumed:** pnpm 11 + Node 24 (`.node-version`), vite-plus's rolldown Vite, esbuild/ts-morph/playwright installed with npm into `.ds-sync/`, Chromium from Playwright's macOS cache. No network assets.

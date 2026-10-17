# One design system for the app and the docs

docs.deevy.dev looked like a different product from the app it documents. Its logo stood 40px tall where
the app's is 22, its paper was Starlight's white rather than the app's blue-gray, a selected page was a solid
indigo bar where the app tints, and its asides were saturated blocks. The only thing the two shared was the
accent's hue, copied by hand into `apps/docs/src/styles/theme.css`. And the logo itself was off the app's
palette: its Human half was a sky blue that, inside the app, marked Humans and nothing else, beside an
indigo that does all the app's acting.

Decided with Matt, 2026-10-17:

| Question       | Decision                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The logo       | Indigo and rose: the Human half-disc takes the app's indigo, the Agent bar keeps its rose. Chosen over indigo and violet, and over an indigo duotone that would no longer tell a Human from an Agent.                                                                          |
| Humans         | Indigo in the app too, so the logo and the screens say the same thing: indigo is a Human and what a Human does (only a Human clicks), rose an Agent, amber a Gate. Sky leaves the palette.                                                                                     |
| Dark mode      | White text on an indigo button, as in light. One indigo cannot carry white text and also read as text on the dark page, so the role splits: `--primary` is the fill (the same indigo in both themes), `--link` the indigo for text, links and a Human's name, lighter in dark. |
| The docs site  | A twin of the app: its paper, ink, borders and corners, a sidebar that tints the selected page as the app's navigation does, quiet asides, Outfit titles at the app's scale, the logo at the app's size.                                                                       |
| Where it lives | `@deevy/design` (`packages/design`): the tokens, the faces and the logo's geometry, imported by `apps/web` and `apps/docs`, so neither copies a value from the other. A published Design System page is the reference to browse and share, written from the package.           |

## What changes

**The package.** `packages/design` holds `tokens.css` (every colour in both themes, the three faces, the
corner radius, the density and the tracking, with the fonts it needs) and `src/logo.ts` (the mark's and the
word's paths and boxes). `brand/build.py` writes the logo's data there and its files where they are served;
the app's `deevy-logo.tsx` and the docs' site title draw from that data, so a change to the logo is one run of
the build. The dark theme is declared for `.dark` (the app, through next-themes) and for `[data-theme="dark"]`
(Starlight), so both sites read the same block. What only the app needs stays in the app: Tailwind's
`@theme` mapping and the sign-in buttons' third-party colours.

**The colours.** `--human` becomes indigo (the `--link` value, since a Human is mostly a name in text),
`--link` is new, dark `--primary` darkens to the light theme's indigo with white text on it, and the code
highlighter, which coloured numbers in `--human`, moves them to green so they stay apart from keywords.

**The docs.** Starlight's `--sl-color-*` are set from the tokens, the site title is the logo drawn inline at
22px in the theme's colours, and the sidebar, the asides, the header and the headings follow the app.

## Slices

1. **`@deevy/design`**: the package, the app importing it, the logo's data moved into it. Nothing on a screen
   changes.
2. **Indigo**: the logo, Humans and dark mode's white button text; `--link`; the favicon and touch icon
   rebuilt.
3. **The docs as the app's twin.**
4. **The reference**: the published Design System page, from the package.

## What it found

- **A tint mixed in oklch turns pink.** An aside tinted `color-mix(in oklch, indigo 6%, white)` came out
  rose: white has no hue, and oklch interpolates toward hue 0. Every tint in the docs' theme mixes in oklab.
- **Indigo as text and as a fill cannot be one value.** White on the dark theme's old indigo read at 3.0:1, and
  the light indigo as text on the dark page at 4.0:1; the light theme's own indigo is 4.27:1 as text on its
  paper. Hence `--link`, a step darker than the fill in light (4.96:1) and lighter in dark (5.87:1), with the
  fill the same indigo in both themes (4.47:1 under white).
- **The code highlighter used `--human` for numbers**, which would have matched its keywords once Humans became
  indigo; numbers are green now.
- **`astro dev` cannot serve Expressive Code's stylesheet**: Starlight's catch-all route answers
  `/_astro/ec.*.css` with a 404, so code blocks have no frame in development while the build is fine. The
  `docs:built` launch configuration serves the built site to check a design change against what ships.
- **The sign-in page's legend said "Round, in sky blue"** and the Member chip's comment the same; both say
  indigo. "Sky" stays as one of the Label palette's eight swatches, which is not the Human colour.

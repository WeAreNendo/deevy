# deevy's logo

A "d" made of two halves: a Human's half-disc in sky and an Agent's bar in rose, standing on one baseline.
Neither makes the letter alone. Beside it, "deevy" in Outfit SemiBold, drawn as outlines.

| File                  | Use                                                                          |
| --------------------- | ---------------------------------------------------------------------------- |
| `deevy-logo.svg`      | The mark and the word, on a light ground                                     |
| `deevy-logo-dark.svg` | The same on a dark ground (lighter sky and rose, near-white word)            |
| `deevy-mark.svg`      | The mark alone, in a square: avatars, app icons, anywhere the word won't fit |
| `deevy-mark-dark.svg` | The mark alone on a dark ground                                              |

Every file is plain SVG with nothing to resolve: paths and hex fills, no `<text>`, fonts, CSS, filters, masks
or links. It reads the same as an `<img>`, in a design tool, or converted to PNG.

## The geometry

In a 100-unit box, the half-disc is centred at (58, 58) with radius 34, its flat side at x 58. The bar is 22
wide (x 62 to 84), 4 units from it, from y 8 to the shared baseline at 92, round on top and square at its foot.

The word's "d" is as tall as the half-disc, stem top to baseline, and sits 8 units higher than the mark's
baseline, so it is centred on the mark's height. The word is set 20 units after the bar (the "d"'s own
side bearing makes the visible gap about 22.6), tracked at −2%.

## Where it is used

`build.py` writes all of these from the geometry above; change it there, never in the outputs.

- `apps/web/public`: `favicon.svg`, `favicon.ico` (16, 32 and 48 px) and `apple-touch-icon.png` (180 px, on
  white).
- `apps/web/src/components/deevy-logo.tsx`: `DeevyMark` and `DeevyLogo`. The mark takes `--human` and
  `--agent`, and the word the text colour, so both follow the theme.
- `apps/docs`: the favicon, and the logo in the header (`src/assets`).

The app sets its page and dialog titles in Outfit (`font-display`, `@fontsource-variable/outfit`), and the
docs site its headings, so the word and the titles are one face.

## Rebuilding

The build needs Python 3 and four packages: fontTools and HarfBuzz to turn Outfit into outlines, resvg and
Pillow for the PNG and ICO files.

```bash
python3 -m venv brand/.venv
```

```bash
brand/.venv/bin/pip install fonttools uharfbuzz resvg-py pillow
```

```bash
brand/.venv/bin/python brand/build.py
```

Then `vp check --fix` formats the component it wrote.

Outfit is in `fonts/` under the SIL Open Font License (`fonts/OFL.txt`), from
[Google Fonts](https://fonts.google.com/specimen/Outfit).

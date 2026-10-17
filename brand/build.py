"""Build every file deevy's logo appears in, from the geometry below and Outfit.

Run from the repository root (see brand/README.md):

    brand/.venv/bin/python brand/build.py
"""

import io
import sys
from pathlib import Path

import resvg_py
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from outline import shape  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"

# The mark, in a 100-unit box: a Human half-disc (indigo) and an Agent bar (rose)
# standing on one baseline. Its ink spans x 24..84 and y 8..92.
DISC = "M58 24A34 34 0 0 0 58 92Z"
BAR = "M62 92V19A11 11 0 0 1 84 19V92Z"
INK = (24, 8, 84, 92)

# The word: Outfit SemiBold, its "d" as tall as the half-disc (68 units), lifted
# 8 so the "d" sits centred on the mark's height, 20 units after the bar.
FONT, AXES, TRACK = "Outfit", {"wght": 600}, -0.02
BASELINE = 92 - 8
WORD_X = INK[2] + 20

# @deevy/design's --human and --agent in each theme (packages/design/tokens.css),
# as hex for the files that cannot read a token: indigo for the Human, rose for
# the Agent (Matt, 2026-10-17).
LIGHT = dict(human="#5a5ce2", agent="#c34e97", ink="#1e293b")
DARK = dict(human="#818cf8", agent="#ef8bc5", ink="#f8fafc")


def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


_, _, d_bounds = shape(FONT, "d", 1000, AXES)
SIZE = 1000 * (92 - 24) / -d_bounds[1]
WORD, ADVANCE, WORD_BOUNDS = shape(FONT, "deevy", SIZE, AXES, TRACK)
# the lockup's box: the mark's ink to the end of the word, down to the "y"'s tail
LOCKUP = (INK[0], INK[1], WORD_X + ADVANCE, max(INK[3], BASELINE + WORD_BOUNDS[3]))


def svg(box, body, title="deevy"):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x0)} {num(y0)} {num(w)} {num(h)}" '
        f'width="{num(w)}" height="{num(h)}" role="img" aria-label="{title}"><title>{title}</title>'
        f"{body}</svg>\n"
    )


def mark_body(c):
    return f'<path d="{DISC}" fill="{c["human"]}"/><path d="{BAR}" fill="{c["agent"]}"/>'


def word_body(c):
    return f'<path transform="translate({num(WORD_X)} {num(BASELINE)})" d="{WORD}" fill="{c["ink"]}"/>'


def square(cx, cy, side):
    return (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)


CENTRE = ((INK[0] + INK[2]) / 2, (INK[1] + INK[3]) / 2)
MARK_BOX = square(*CENTRE, INK[3] - INK[1])  # the ink, squared up


def png(markup, size, background=None):
    data = resvg_py.svg_to_bytes(svg_string=markup, width=size, height=size, background=background)
    return Image.open(io.BytesIO(bytes(data))).convert("RGBA")


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(path.relative_to(ROOT))


def main():
    mark = svg(MARK_BOX, mark_body(LIGHT))
    write(BRAND / "deevy-logo.svg", svg(LOCKUP, mark_body(LIGHT) + word_body(LIGHT)))
    write(BRAND / "deevy-logo-dark.svg", svg(LOCKUP, mark_body(DARK) + word_body(DARK)))
    write(BRAND / "deevy-mark.svg", mark)
    write(BRAND / "deevy-mark-dark.svg", svg(MARK_BOX, mark_body(DARK)))

    # The SPA and the docs site: the mark in its light colours reads on light
    # and dark browser chrome alike.
    for public in (ROOT / "apps/web/public", ROOT / "apps/docs/public"):
        write(public / "favicon.svg", mark)
    sizes = [png(mark, s) for s in (16, 32, 48)]
    ico = ROOT / "apps/web/public/favicon.ico"
    sizes[-1].save(ico, sizes=[(16, 16), (32, 32), (48, 48)], append_images=sizes[:-1])
    print(ico.relative_to(ROOT))
    # iOS rounds the corners itself and wants no transparency: the mark at
    # two thirds of the tile, on white.
    touch = svg(square(*CENTRE, (INK[3] - INK[1]) * 1.5), mark_body(LIGHT))
    path = ROOT / "apps/web/public/apple-touch-icon.png"
    png(touch, 180, "#ffffff").convert("RGB").save(path, optimize=True)
    print(path.relative_to(ROOT))


    x0, y0, x1, y1 = LOCKUP
    lockup_box = f"{num(x0)} {num(y0)} {num(x1 - x0)} {num(y1 - y0)}"
    mx0, my0, mx1, my1 = INK
    # The logo as data, for the app's component and the docs site's title to
    # draw in the theme's colours (packages/design/src/logo.ts).
    write(
        ROOT / "packages/design/src/logo.ts",
        f'''/*
 * deevy's logo as data, written by brand/build.py: change it there and run it
 * again (brand/README.md).
 *
 * A "d" made of two halves standing on one baseline, a Human's half-disc and an
 * Agent's bar, beside "deevy" in Outfit SemiBold as outlines. The paths carry
 * no colour: whoever draws them fills the disc with --human, the bar with
 * --agent and the word with the text colour, so the logo follows the theme. The
 * app draws it in components/deevy-logo.tsx, the docs site in its site title.
 */

/** The Human's half-disc. */
export const disc = "{DISC}";

/** The Agent's bar. */
export const bar = "{BAR}";

/** "deevy", drawn at `wordAt`. */
export const word =
  "{WORD}";

/** Where the word's origin sits: its baseline, after the bar. */
export const wordAt = {{ x: {num(WORD_X)}, y: {num(BASELINE)} }};

/** The mark's ink, as a viewBox. */
export const markBox = "{mx0} {my0} {mx1 - mx0} {my1 - my0}";

/** The mark and the word together, down to the "y"'s tail, as a viewBox. */
export const lockupBox = "{lockup_box}";
''',
    )

if __name__ == "__main__":
    main()

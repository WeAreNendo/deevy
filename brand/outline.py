"""Text to SVG path outlines: HarfBuzz shapes (kerning, variations), fontTools draws."""

from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent / "fonts"


@lru_cache(None)
def _ttfont(name):
    return TTFont(FONTS / f"{name}.ttf")


@lru_cache(None)
def _hbfont(name, axes):
    """One HarfBuzz font per set of axis values: `set_variations` changes the
    font it is called on, so a shared one would keep whatever the last call set."""
    blob = hb.Blob.from_file_path(str(FONTS / f"{name}.ttf"))
    font = hb.Font(hb.Face(blob))
    if axes:
        font.set_variations(dict(axes))
    return font


def _fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class _Pen(SVGPathPen):
    def __init__(self, gs):
        super().__init__(gs, ntos=_fmt)


def shape(font, text, size, axes=None, tracking=0.0, features=None):
    """Return (d, advance, bounds) for `text` at baseline y=0, origin x=0.

    `tracking` is in em units (0.02 = +2%). Bounds are (xmin, ymin, xmax, ymax) in SVG space.
    """
    tt = _ttfont(font)
    upem = tt["head"].unitsPerEm
    f = _hbfont(font, tuple(sorted((axes or {}).items())))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(f, buf, features or {"kern": True, "liga": False})
    gs = tt.getGlyphSet(location=axes or None)
    order = tt.getGlyphOrder()
    scale = size / upem
    pen = _Pen(gs)
    bp = BoundsPen(gs)
    x = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        # font units, y up -> svg, y down
        t = (scale, 0, 0, -scale, (x + pos.x_offset) * scale, -pos.y_offset * scale)
        gs[name].draw(TransformPen(pen, t))
        gs[name].draw(TransformPen(bp, t))
        x += pos.x_advance + tracking * upem
    x -= tracking * upem
    return pen.getCommands(), x * scale, bp.bounds


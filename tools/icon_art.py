"""The Factory Flow mark, shared by tools/app-icon.py and tools/tray-icon.py.

The mark is the real Factory glyph (src/client/public/factory-glyph.svg) turning clockwise: a sharp
glyph in a warm gradient over its own fading trail, like a long exposure of the six-armed pinwheel.
Everything is drawn from the glyph's path, so nothing here is a traced or raster copy of it.
"""

import io
import math
import re
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GLYPH_SVG = ROOT / "src" / "client" / "public" / "factory-glyph.svg"
# The glyph is a six-armed pinwheel; this is the centre it turns about (the favicon centred on it already).
CENTER = (9.753, 9.237)
# Radius that holds every arm tip around CENTER, in glyph units.
RADIUS = 10.3

ORANGE = "#f06000"
EMBER_TOP = "#1d100a"
EMBER_BOTTOM = "#060302"


def glyph_path() -> str:
    return re.search(r' d="([^"]+)"', GLYPH_SVG.read_text()).group(1)


def squircle(x: float, y: float, size: float, n: float = 5.0, steps: int = 180) -> str:
    """A superellipse, close to the continuous corner of a macOS icon."""
    half = size / 2
    points = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        px = x + half + half * math.copysign(abs(c) ** (2 / n), c)
        py = y + half + half * math.copysign(abs(s) ** (2 / n), s)
        points.append(f"{px:.2f},{py:.2f}")
    return "M" + " L".join(points) + "Z"


def mix(a: str, b: str, t: float) -> str:
    pa = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(pa, pb))


def trail(count: int, step: float, peak: float, near: str = ORANGE, far: str = "#c2182b") -> list[tuple[float, str, float]]:
    """(degrees behind the glyph, colour, opacity) for each echo, nearest first: warm and strong, then red and fading."""
    out = []
    for i in range(1, count + 1):
        t = i / count
        out.append((step * i, mix(near, far, t), peak * (1 - t * 0.9) ** 1.5))
    return out


def mark(cx: float, cy: float, scale: float, echoes: list[tuple[float, str, float]], blur: float = 0.0, bold: float = 0.0, gradient_id: str = "flow-main") -> tuple[str, str]:
    """(defs, body) of the mark centred on (cx, cy) with the glyph `scale` pixels per glyph unit.

    `bold` thickens the sharp glyph by that many glyph units of outline so its thin arms survive 16 px."""
    gx, gy = CENTER

    def at(angle: float) -> str:
        return f"translate({cx:.3f},{cy:.3f}) rotate({-angle:.3f}) scale({scale:.4f}) translate({-gx},{-gy})"

    defs = [
        f'<path id="glyph" fill-rule="evenodd" d="{glyph_path()}"/>',
        f'<linearGradient id="{gradient_id}" gradientUnits="userSpaceOnUse" x1="{gx - RADIUS:.2f}" y1="{gy - RADIUS:.2f}" x2="{gx + RADIUS:.2f}" y2="{gy + RADIUS:.2f}">'
        '<stop offset="0" stop-color="#ffd08a"/><stop offset="0.38" stop-color="#ff8f24"/><stop offset="0.72" stop-color="#f06000"/><stop offset="1" stop-color="#d63a08"/></linearGradient>',
    ]
    body = []
    if blur:
        defs.append(f'<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{blur}"/></filter>')
    body.append('<g filter="url(#soft)">' if blur else "<g>")
    for angle, color, opacity in reversed(echoes):
        body.append(f'<use href="#glyph" fill="{color}" fill-opacity="{opacity:.3f}" transform="{at(angle)}"/>')
    body.append("</g>")
    outline = f' stroke="url(#{gradient_id})" stroke-width="{bold}" stroke-linejoin="round"' if bold else ""
    body.append(f'<use href="#glyph" fill="url(#{gradient_id})"{outline} transform="{at(0)}"/>')
    return "".join(defs), "".join(body)


def svg(size: float, defs: str, body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {size:g} {size:g}" width="{size:g}" height="{size:g}"><defs>{defs}</defs>{body}</svg>'


def render(svg_text: str, pixels: int | None = None) -> Image.Image:
    kwargs = {"svg_string": svg_text}
    if pixels is not None:
        kwargs["width"] = pixels
        kwargs["height"] = pixels
    return Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(**kwargs)))).convert("RGBA")

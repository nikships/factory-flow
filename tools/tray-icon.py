"""Draws the Mac app's menu bar icon from the Factory glyph's own path.

    uv run --with pillow --with resvg-py python tools/tray-icon.py [--sheet DIR]

Writes src/desktop/tray-icon.ts: the mark at 18 pt (@1x and @2x) as a black template image, which
macOS tints for the light or dark menu bar. A running office draws it at full strength and a stopped
office at 40% (a template image only keeps its alpha, so the state is the strength). With --sheet it
also saves the icon on a light and a dark menu bar, at its real size and enlarged, into DIR.
Commit what it writes.
"""

import argparse
import base64
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import icon_art as art  # noqa: E402

OUT = art.ROOT / "src" / "desktop" / "tray-icon.ts"
POINTS = 18
# The mark spans 17 of the 18 points, as Apple's menu bar icons leave half a point of air on each side.
MARK_POINTS = 17
# How much of the mark's strength a stopped office keeps.
DIMMED = 0.4
# One faint echo behind the glyph keeps the sense of turning; more would blur at this size.
ECHOES = [(10.0, "#000000", 0.32)]
BOLD = 0.55


def svg() -> str:
    unit = MARK_POINTS / (2 * art.RADIUS)
    defs, body = art.mark(POINTS / 2, POINTS / 2, unit, ECHOES, 0.0, BOLD)
    # The mark is one colour: the gradient's stops collapse to black, so only the alpha is left.
    defs = defs.replace("#ffd08a", "#000000").replace("#ff8f24", "#000000").replace("#f06000", "#000000").replace("#d63a08", "#000000")
    return art.svg(POINTS, defs, body)


def png(scale: int, strength: float) -> Image.Image:
    image = art.render(svg(), POINTS * scale)
    alpha = image.getchannel("A").point(lambda v: round(v * strength))
    image.putalpha(alpha)
    return image


def encode(image: Image.Image) -> str:
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return base64.b64encode(out.getvalue()).decode("ascii")


def sheet(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    bars = [("light menu bar", (238, 238, 240, 255), 0), ("dark menu bar", (38, 38, 41, 255), 255)]
    width, height = 560, 2 * 150
    out = Image.new("RGBA", (width, height), (120, 120, 120, 255))
    draw = ImageDraw.Draw(out)
    for row, (label, bar, ink) in enumerate(bars):
        top = row * 150
        draw.rectangle((0, top, width, top + 150), fill=bar)
        text = (0, 0, 0, 255) if ink == 0 else (255, 255, 255, 255)
        draw.text((12, top + 8), label, fill=text)
        for column, (state, strength) in enumerate([("running", 1.0), ("stopped", DIMMED)]):
            x = 12 + column * 270

            def tint(scale: int) -> Image.Image:
                icon = png(scale, strength)
                tinted = Image.new("RGBA", icon.size, (ink, ink, ink, 255))
                tinted.putalpha(icon.getchannel("A"))
                return tinted

            # The @1x and @2x files as drawn, then the @2x one enlarged so its pixels can be judged.
            out.alpha_composite(tint(1), (x, top + 40))
            out.alpha_composite(tint(2), (x + 30, top + 40))
            out.alpha_composite(tint(2).resize((36 * 3, 36 * 3), Image.NEAREST), (x + 90, top + 24))
            draw.text((x, top + 130), state, fill=text)
    path = directory / "factory-flow-tray-icon.png"
    out.save(path, "PNG", optimize=True)
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, help="also save the menu bar preview into this folder")
    args = parser.parse_args()
    icons = {"running": {scale: encode(png(scale, 1.0)) for scale in (1, 2)}, "stopped": {scale: encode(png(scale, DIMMED)) for scale in (1, 2)}}
    lines = [
        "// Written by tools/tray-icon.py from the Factory glyph; run it again rather than editing this file.",
        "",
        "/** The menu bar template icon, base64 PNGs at 18 pt: black alpha only, full strength for a running office and 40% for one that isn't. */",
        "export const TRAY_ICON = {",
    ]
    for state, scales in icons.items():
        lines.append(f"  {state}: {{")
        for scale, data in scales.items():
            lines.append(f"    x{scale}: '{data}',")
        lines.append("  },")
    lines.append("} as const;")
    OUT.write_text("\n".join(lines) + "\n")
    if args.sheet:
        print(sheet(args.sheet))


if __name__ == "__main__":
    main()

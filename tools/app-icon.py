"""Draws the Factory Flow app icon and every size of it, from the Factory glyph's own path.

    uv run --with pillow --with resvg-py python tools/app-icon.py [--sheet DIR]

Writes build/icon.svg and build/icon.png (the macOS source electron-builder turns into the .icns),
src/client/public/favicon.svg and icons/*.png (PWA, maskable, apple-touch), and the Android adaptive
icon layers in android/app/src/main/res/drawable. With --sheet it also saves a contact sheet of the
icon at 1024, 256, 64, 32 and 16 px into DIR. Run tools/tray-icon.py afterwards for the menu bar icon.
Commit what it writes.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import icon_art as art  # noqa: E402

ROOT = art.ROOT
DRAWABLE = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable"
PUBLIC = ROOT / "src" / "client" / "public"
# Glyph units per canvas unit in the favicon and PWA icons, which let the mark fill the squircle for 16 px legibility.
ROUNDED_SCALE = 0.041
GRADIENT = [("0", "#ffd08a"), ("0.38", "#ff8f24"), ("0.72", "#f06000"), ("1", "#d63a08")]


def icon_svg(canvas: float, body_size: float, scale: float, echoes, blur: float, bold: float, shadow: bool, shape: str = "squircle") -> str:
    """The icon on a `canvas`, with a body `body_size` wide in the middle (macOS leaves margin for the shadow)."""
    margin = (canvas - body_size) / 2
    outline = art.squircle(margin, margin, body_size) if shape == "squircle" else f"M0,0H{canvas:g}V{canvas:g}H0Z"
    centre = canvas / 2
    halo = scale * art.RADIUS * 1.25
    mark_defs, mark_body = art.mark(centre, centre, scale, echoes, blur, bold)
    defs = [
        f'<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{art.EMBER_TOP}"/><stop offset="1" stop-color="{art.EMBER_BOTTOM}"/></linearGradient>',
        f'<radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="{centre:g}" cy="{centre:g}" r="{halo:g}">'
        f'<stop offset="0" stop-color="{art.ORANGE}" stop-opacity="0.34"/><stop offset="0.6" stop-color="{art.ORANGE}" stop-opacity="0.10"/><stop offset="1" stop-color="{art.ORANGE}" stop-opacity="0"/></radialGradient>',
        '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.03"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.08"/></linearGradient>',
        f'<clipPath id="clip"><path d="{outline}"/></clipPath>',
        mark_defs,
    ]
    body = []
    if shadow:
        defs.append(f'<filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="{canvas * 0.018:g}"/></filter>')
        body.append(f'<path d="{outline}" transform="translate(0,{canvas * 0.014:g})" fill="#000000" fill-opacity="0.5" filter="url(#drop)"/>')
    body.append(f'<path d="{outline}" fill="url(#body)"/>')
    body.append(f'<g clip-path="url(#clip)"><circle cx="{centre:g}" cy="{centre:g}" r="{halo:g}" fill="url(#halo)"/>{mark_body}</g>')
    if shape == "squircle":
        body.append(f'<path d="{outline}" fill="none" stroke="url(#rim)" stroke-width="{max(canvas * 0.003, 0.6):g}"/>')
    return art.svg(canvas, "".join(defs), "".join(body))


def app_icon() -> str:
    return icon_svg(1024, 824, 30.0, art.trail(9, 3.6, 0.62), 1.6, 0.35, shadow=True)


def rounded_icon(size: float, scale_ratio: float, steps: int) -> str:
    """The favicon and the 'any' PWA icons: the squircle fills the canvas, and the mark stays bold at 16 px."""
    return icon_svg(size, size, size * scale_ratio, art.trail(steps, 5.0, 0.7), 0.0, 0.7, shadow=False)


def flat_square(size: float, glyph_radius_ratio: float) -> str:
    """Full-bleed square for the maskable and apple-touch icons: the platform draws the corners."""
    scale = size * glyph_radius_ratio / art.RADIUS
    return icon_svg(size, size, scale, art.trail(8, 4.0, 0.6), 0.0, 0.5, shadow=False, shape="square")


def png(svg_text: str, pixels: int, out: Path) -> None:
    art.render(svg_text, pixels).save(out, "PNG", optimize=True)


ANDROID_HEADER = (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
    '    xmlns:aapt="http://schemas.android.com/aapt"\n'
    '    android:width="108dp"\n    android:height="108dp"\n'
    '    android:viewportWidth="108"\n    android:viewportHeight="108">\n'
)


def android_layers() -> dict[str, str]:
    gx, gy = art.CENTER
    scale = 2.9  # the mark's radius is 30 of the 33 dp every launcher mask keeps
    tx, ty = 54 - gx * scale, 54 - gy * scale

    def turned(path: str, angle: float = 0.0) -> str:
        return (
            f'    <group android:rotation="{-angle:g}" android:pivotX="54" android:pivotY="54">\n'
            f'        <group android:scaleX="{scale}" android:scaleY="{scale}" android:translateX="{tx:.2f}" android:translateY="{ty:.2f}">\n'
            f"{path}\n        </group>\n    </group>\n"
        )

    def flat(color: str, alpha: float | None = None) -> str:
        alpha_line = f'\n            android:fillAlpha="{alpha:.3f}"' if alpha is not None else ""
        return f'        <path\n            android:fillColor="{color}"{alpha_line}\n            android:fillType="evenOdd"\n            android:pathData="@string/glyph_path" />'

    reach = art.RADIUS
    stops = "".join(f'\n                    <item android:color="{color.upper()}" android:offset="{offset}" />' for offset, color in GRADIENT)
    gradient = (
        '        <path\n            android:fillType="evenOdd"\n            android:pathData="@string/glyph_path">\n'
        '            <aapt:attr name="android:fillColor">\n'
        f'                <gradient android:type="linear" android:startX="{gx - reach:.2f}" android:startY="{gy - reach:.2f}" android:endX="{gx + reach:.2f}" android:endY="{gy + reach:.2f}">{stops}\n'
        "                </gradient>\n            </aapt:attr>\n        </path>"
    )

    foreground = ANDROID_HEADER
    for angle, color, opacity in reversed(art.trail(8, 4.0, 0.6)):
        foreground += turned(flat(color.upper(), opacity), angle)
    foreground += turned(gradient) + "</vector>\n"

    monochrome = ANDROID_HEADER
    for angle, _, opacity in reversed(art.trail(3, 5.0, 0.55)):
        monochrome += turned(flat("#FFFFFF", opacity), angle)
    monochrome += turned(flat("#FFFFFF")) + "</vector>\n"

    background = (
        ANDROID_HEADER
        + '    <path android:pathData="M0,0h108v108h-108z">\n        <aapt:attr name="android:fillColor">\n'
        '            <gradient android:type="linear" android:startX="54" android:startY="0" android:endX="54" android:endY="108">\n'
        f'                <item android:color="{art.EMBER_TOP.upper()}" android:offset="0" />\n'
        f'                <item android:color="{art.EMBER_BOTTOM.upper()}" android:offset="1" />\n'
        "            </gradient>\n        </aapt:attr>\n    </path>\n"
        "    <!-- An ember behind the mark: the accent orange, fading out before the mask's edge. -->\n"
        '    <path android:pathData="M0,0h108v108h-108z">\n        <aapt:attr name="android:fillColor">\n'
        '            <gradient android:centerX="54" android:centerY="54" android:gradientRadius="52" android:type="radial">\n'
        '                <item android:color="#57F06000" android:offset="0" />\n'
        '                <item android:color="#1AF06000" android:offset="0.55" />\n'
        '                <item android:color="#00F06000" android:offset="1" />\n'
        "            </gradient>\n        </aapt:attr>\n    </path>\n</vector>\n"
    )
    return {"ic_launcher_foreground.xml": foreground, "ic_launcher_monochrome.xml": monochrome, "ic_launcher_background.xml": background}


def contact_sheet(master: Image.Image, directory: Path) -> Path:
    sizes = [1024, 256, 64, 32, 16]
    gap = 48
    sheet = Image.new("RGBA", (sum(sizes) + gap * (len(sizes) + 1), 1024 + gap * 2 + 24), (236, 234, 231, 255))
    draw = ImageDraw.Draw(sheet)
    x = gap
    for size in sizes:
        sheet.alpha_composite(master.resize((size, size), Image.LANCZOS), (x, gap + (1024 - size) // 2))
        draw.text((x, 1024 + gap + 8), f"{size} px", fill=(40, 40, 40, 255))
        x += size + gap
    out = directory / "factory-flow-icon-sizes.png"
    sheet.save(out, "PNG", optimize=True)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, help="also save the contact sheet into this folder")
    args = parser.parse_args()

    master_svg = app_icon()
    (ROOT / "build" / "icon.svg").write_text(master_svg)
    master = art.render(master_svg, 1024)
    master.save(ROOT / "build" / "icon.png", "PNG", optimize=True)

    (PUBLIC / "favicon.svg").write_text(rounded_icon(64, ROUNDED_SCALE, 4))
    icons = PUBLIC / "icons"
    png(rounded_icon(512, ROUNDED_SCALE, 6), 512, icons / "icon-512.png")
    png(rounded_icon(512, ROUNDED_SCALE, 6), 192, icons / "icon-192.png")
    png(flat_square(512, 0.38), 512, icons / "icon-maskable-512.png")
    png(flat_square(180, 0.42), 180, icons / "apple-touch-icon.png")

    for name, text in android_layers().items():
        (DRAWABLE / name).write_text(text)

    if args.sheet:
        args.sheet.mkdir(parents=True, exist_ok=True)
        print(contact_sheet(master, args.sheet))


if __name__ == "__main__":
    main()

# Terminal glyphs

The companion's terminals (`/dashboard`, the Mac app and the Android WebView) draw prompt icons from a bundled symbols font, `DroidOfficeTerminalSymbols-Regular.woff2` in `src/client/public/fonts/`. It is an OFL derivative of Nerd Fonts 3.4.0, renamed because it is modified. The bundled OFL notice and the source copyright metadata stay with it.

## Why it is modified

Geist Mono advances each text cell by 0.6em. The original symbols font advanced its icons by 1em, with outlines that can also fill 1em. At 20 px that is 12 px per text cell against 20 px per icon. xterm's next colored cell covered the end of U+F1D3 (`git`), and canvas `fillText` runs drifted beyond their cell-counted backgrounds, so `main` rendered as `mair`.

The derivative gives every icon a 600-unit advance in a 1000-unit em:

- Ordinary icons scale uniformly only when their outlines need to fit, and are centered in the cell. Narrow icons keep their height.
- Powerline separators keep their height and meet both horizontal cell edges.
- Regular and bold terminal text use the same icon outlines, so synthetic bold never extends beyond the cell.

Terminals open after the shared font load settles (`TERM_FONT` in `src/client/fonts.ts`), so xterm's first cached measurements use the loaded faces. Symbols outside the bundled ranges still use the system fallbacks.

## Rebuild the font

The input is the formerly bundled Nerd Fonts 3.4.0 subset from commit `2df9683`, derived from `NerdFontsSymbolsOnly.zip`. Its SHA256 is `dd8e4fa2ed0d55d24475b7ab618eb5f814349d0ad82423bd1256bb6c45e647e0`. The builder verifies that input, renames the derivative and validates the output. No Python dependency is needed to build or run Factory Flow.

```bash
git show 2df9683:src/client/public/fonts/SymbolsNerdFontMono-Regular.woff2 > /tmp/office-symbols-source.woff2
uv run --with fonttools==4.66.1 --with brotli==1.2.0 python tools/terminal-symbols.py /tmp/office-symbols-source.woff2 src/client/public/fonts/DroidOfficeTerminalSymbols-Regular.woff2
```

The output SHA256 is `6bd53aae55b56dc0187664cfef607fa4abd3a08bfa3aad5e19810381bc94bbfb`. A second pinned rebuild produces identical bytes.

## Checks

- Every one of the 7,595 mapped icons has a 0.6em advance, all outlines fit horizontally and every separator meets both cell edges.
- Browser canvas checks covered U+F179, U+F115, U+F1D3, U+F126, U+E0B0 and U+E0B2, plus BMP and supplementary devicons, at 10, 14, 16, 20, 25.9307, 30 and 36 px in regular and bold. Mixed icon and text runs advanced by their intended cell count.
- A delayed font load, closing before it completes and reopening left one terminal and one attach.

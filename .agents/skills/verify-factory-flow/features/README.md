# Factory Flow verification map

This directory is the maintained source for verifying the user-facing behavior of Factory Flow. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Build this checkout with `npm ci` or `npm run build`.
- Launch with `scripts/launch.sh` (clone of the owner's office) or `scripts/launch.sh --fresh` (no installed office on this machine). Keep the printed `RUN` and `EVIDENCE`.
- Run `scripts/doctor.sh "$RUN"` and require no `fail` lines.
- Drive only the office this run launched; the helpers refuse :4700.

## Driving conventions

- Start from the dashboard with any settings or modal windows closed.
- Use accessible roles and `data-worker`/`data-floor` handles; coordinates and tab order break between runs.
- Run office page drives through `scripts/drive.sh "$RUN" <steps.mjs> <name>`.
- Undo what a recipe makes: send hired workers home, and delete cards or comments the run created. Proof artifacts stay.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes numbered screenshots and the drive's `transcript.txt`.
- Mutation proof includes a second, read-only view, such as the web companion row or a file the worker wrote.
- Record the feature ID and entry point with every artifact (the drive name, `proof.json`).
- Report an unreachable path with the command you tried and the unmet precondition, as skipped: an entry point counts as verified only through its own path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

Historical dates below are not proof of changed entry points. Rerun the listed companion driver after changes.

| Feature | Surface | Last live proof |
| --- | --- | --- |
| [Airgapped setup](./airgapped.md) | web companion model API, Android picker | Browser on Linux, fresh credential-free office, welcome/settings at 1440×900 and 1024×700, missing-model blocking and HTTP guards, 2026-11-11; real BYOK turn and Android execution pending |
| [Hire a worker](./hire-worker.md) | web companion | Phase A1, fresh companion: Shell hire, real terminal output, independent file side effect, send-home confirmation and removal; hire dialog opened and cancelled |
| [Whiteboard](./whiteboard.md) | web companion, Android | Historical browser proof, before the companion-only strip, owner clone, `/dashboard` at 1440×900 and 1024×700 (Markdown, Video, SVG, Factory HTML, Canvas, search/filters, in-place edit, comment edit & `@mm:ss` video seek, cleanup), 2026-11-11; Android JVM unit/lint/R8 verified, live adb device pending |
| [Office MCP tool call](./office-mcp.md) | Office MCP over HTTP | Phase A1, fresh companion: anonymous and Shell calls both refused with 401; agent calls require a signed-in Droid |
| [Mission Control](./mission-control.md) | web/Mac companion, Android, Office MCP | Phase A1, fresh browser: pinned row, blocked thread, shared setting toggle and restoration; real turns, signed Mac window and Android not exercised |
| [Android Workers list](./android-workers.md) | Android app (adb) | Pixel 9 Pro XL emulator, cloned owner office: Shell from Asks and past a pending Droid snackbar |

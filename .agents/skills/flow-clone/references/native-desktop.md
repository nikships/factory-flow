# Native desktop checks on macOS

Use a properly signed Factory Flow build with a dedicated `--user-data-dir`. Never edit or replace files inside an app bundle.

Load `agent-desktop-macos` before operating native menus or windows. Scope the reusable `scripts/flow-desktop.mjs` AX helper to the test app's PID; it remains available for signed-app checks, but the headless companion runner does not launch it.

Use the isolated browser runner for companion DOM controls and screenshots. Native window/tray/update checks require a matching signed build and should be reported as unverified when that build is unavailable. A browser screenshot proves neither native pixels nor Mac startup.

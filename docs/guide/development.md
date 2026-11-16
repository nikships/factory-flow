# Development

Developers can clone, run and modify the source on their own machines. Source checkouts and custom deployments are not supported production installs; the production distribution is the [Mac app release](getting-started.md#the-mac-app).

```bash
git clone https://github.com/nikships/factory-flow.git
cd factory-flow
npm ci               # also builds, and installs the pre-commit hook
npm run dev          # Vite on :5173, server on :4700
npm run build        # vite (client) + tsc (server and desktop app)
npm run lint         # Oxlint + Biome policy and formatting checks, fails on any warning
npm run format       # Biome: rewrite the files in the house format
npm run typecheck    # npm-locked Bun: all three TypeScript projects
npm test             # worker, pipelines, PTY and doc tests, and .env.example in sync
npm run test:coverage  # the same tests with a coverage report; needs Node 22.8+
node bin/factory-flow.js /path/to/project
npm run desktop      # builds, then runs the Mac app from the checkout (it doesn't update itself)
npm run package:mac  # builds release/Factory Flow.app, a dmg and a zip; signs with your Developer ID if the keychain has it
```

`npm run package:mac` notarizes the app too when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set; `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac -- -c.mac.identity=null` builds it unsigned. electron-builder's settings are in [`electron-builder.yml`](../../electron-builder.yml), and the icon and entitlements in [`build/`](../../build).

A worktree the office cuts of this repository sets itself up from [`.factory-flow.json`](../../.factory-flow.json): it copies `android/local.properties` from the checkout when there is one and runs `npm ci`.

**Lint and format.** [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) runs the correctness rules in [`.oxlintrc.json`](../../.oxlintrc.json). Its categories do not map one-to-one to Biome's recommended preset, so [Biome](https://biomejs.dev) deliberately remains a compatibility check for the existing recommended lint policy, including suspicious, complexity and style rules. This is not yet an Oxlint-only lint gate. Both CI and pre-commit run both linters; CI also checks formatting. [`biome.jsonc`](../../biome.jsonc) keeps two-space indents, single quotes, semicolons, trailing commas and 240-column lines. `npm run format` fixes the formatting.

**Typechecking.** [`bun check`](https://bun.com/docs/runtime/check) reads the same tsconfigs and reports TypeScript 7 diagnostics without emitting files. Bun 1.4.4 embeds TypeScript 7.0.2, matching the locked `typescript` package. `tests/typecheck-parity.test.ts` runs both compilers on all three real projects and compares their diagnostics on injected type errors under each project's options. Builds still use `tsc` to emit JavaScript. npm supplies Bun from `package-lock.json` on developer machines and all CI runners; a global Bun installation is not required. A scripts-disabled install leaves Bun's executable as a stub, so run `npm rebuild bun` after `npm ci --ignore-scripts` before typechecking.

**Pre-commit hook.** `npm ci` or `npm install` in a clone points git at [`.husky/`](../../.husky) (through the `prepare` script), and every commit then runs [lint-staged](https://github.com/lint-staged/lint-staged) and `npm run typecheck`. lint-staged runs `oxlint --deny-warnings` and `biome check --write --error-on-warnings` on the staged files, so formatting is fixed and added to the commit, and a lint finding stops it. The hook is a convenience; CI runs the same `npm run lint` and `npm run typecheck`. `git commit --no-verify` skips it, and `HUSKY=0` skips installing it. It isn't installed in CI (`CI=true`) or where dev dependencies aren't.

`npm run test:coverage` fails when line or function coverage of `src/` and `bin/` drops below the thresholds in its `package.json` script, and CI runs it in place of `npm test`. `npm test` still runs on Node 20.

`npm run dev` runs Vite with hot reload on :5173 and proxies to the server on :4700. Server edits restart the server, not the workers.

### Isolated verification

Build the checkout and start its daemon on a spare port with a temporary home and project folder. Open `/` and `/dashboard` in an isolated browser, hire a shell and verify a terminal input/output round trip. Stop the daemon and its test terminals afterwards. Do not touch the owner's `:4700`.

The repository's `flow-clone` skill (`.agents/skills/flow-clone/`) clones your installed state for running-office checks, and `verify-factory-flow` (`.agents/skills/verify-factory-flow/`) launches, drives and cleans up an isolated run with screenshots and transcripts.

The companion has no scene automation API. Drive its ordinary DOM controls or the existing WebSocket protocol. Test a packaged Mac app only when properly signed, with an isolated `--user-data-dir`; never alter an app bundle.

Rules for changing the code are in [`AGENTS.md`](../../AGENTS.md). A directory with its own rules has an `AGENTS.md` beside the code; the root file lists them.

## Releases

Every change to the app that lands on `main` is published as a GitHub release by [`.github/workflows/release.yml`](../../.github/workflows/release.yml). The Mac app is the only supported production installation; there is no standalone server tarball or npm publication, and `package.json` marks the package private.

Everything runs on GitHub-hosted runners, with nothing to register or repair:

| Job | Runner | What it does |
| --- | --- | --- |
| `changes` | `ubuntu-latest` | Works out which checks and platforms the change touches and the release version (`.github/scripts/release-changes.mjs`). |
| `checks` | `ubuntu-latest` | Office build, lint, typecheck, the Chromium rendering check, coverage and the checkout startup smoke test. |
| `mac` | `macos-26` (Apple silicon) | Compiles the app; on `main` also signs, notarizes and staples it, and runs the startup checks. |
| `android` | `ubuntu-latest` (JDK 21) | Debug unit tests and lint; on `main` also the signed release APK. |
| `publish` | `ubuntu-latest` | On `main`, assembles the release from the platform jobs' artifacts. |

Pull requests run only the checks affected by their paths: the office build, lint, typecheck, coverage and checkout startup smoke test; Mac source compilation; and Android debug unit tests and lint. They never set release versions, download Electron, package an unsigned Mac app, build a release APK, read secrets or upload release artifacts. Only the change-detection job fetches git history to compare the complete change and count commits for release versions. New pushes to a PR cancel its older run.

The `checks` job caches the pinned Chromium headless shell and installs its AppArmor profile. The Ubuntu image already supplies Chromium's shared libraries, so CI does not run Playwright's `install-deps` (which refreshes apt and downloads extra fonts even with a cached browser). Before the full suite the job launches the office's real sandboxed browser and renders a page, with a one-minute limit; missing libraries, a blocked sandbox or rendering errors still fail the job.

On `main`, the affected platforms also build release artifacts. The `mac` job imports the Developer ID Application certificate into a temporary keychain (`MAC_CERTS`, `CERT_PASSWORD`; electron-builder's own keychain handling fails on macOS 26), has electron-builder sign the app and notarize and staple it with Apple (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`), runs the signed app's isolated `--startup-check`, starts the office on the app's own Electron, then verifies the signature and Gatekeeper's verdict, and notarizes and staples the disk image. The app requires macOS 14+ and arm64, without a GPU-tier gate. The release's `latest-mac.yml` carries `minimumSystemVersion: 23.0.0`, so Macs on macOS 13 or earlier are not offered it. The `android` job signs the companion APK with the release keystore (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) and checks the result with `apksigner verify --print-certs`; it refuses to ship a debug-signed APK, which could never update an installed app. The signing identity is the Team `NW6B3R27LQ` Developer ID and the Android keystore stays the same for every release; losing it means no APK can update an installed app again. GitHub secrets can't be read back, so keep the originals.

The jobs hand their files to `publish` through GitHub's artifact service (`mac`: the dmg, zip, blockmap and `latest-mac.yml`; `android`: the APK; one day's retention). Only once all affected checks and builds pass does the release go up, marked Latest, with the dmg, zip, update metadata and companion APK. Unchanged platforms retain their existing signed assets and versions, copied from the current Latest release, so both installed apps can keep reading Latest. An older run never replaces a newer release. Test/docs-only changes publish nothing. A manual workflow run checks every platform, but builds and publishes release artifacts only when run on `main`. A release is named after `package.json`'s major.minor and the number of commits on `main` (`v0.1.68`), so every release is a new version the app updates to; bump `package.json` to start a new minor version.

### App icon

[`tools/app-icon.py`](../../tools/app-icon.py) draws the Factory Flow icon from the Factory glyph's own path (`src/client/public/factory-glyph.svg`): the pinwheel in an orange gradient turning clockwise over a fading trail, on a near-black squircle. It writes `build/icon.svg` and `build/icon.png` (the source for electron-builder's `.icns`), the favicon and PWA icons, and the Android adaptive icon layers; [`tools/tray-icon.py`](../../tools/tray-icon.py) writes the menu bar template icon. Both run with `uv run --with pillow --with resvg-py python tools/<name>.py`, and `--sheet <folder>` saves a contact sheet. Previews of the current icon are in [`docs/assets/`](../assets).

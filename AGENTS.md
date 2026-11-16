# Factory Flow

A local companion workspace where one owner hires Droid workers and works in their live PTYs, backed by a Node server, a Vite web client, an Electron Mac app and an Android companion.

## Subsystem and design references

- **Subsystems** (status hooks, PTY host, worktrees, pipelines, floors, `.factory-flow/` state files): read and update the matching bullet in [docs/guide/how-it-works.md](docs/guide/how-it-works.md) in the same change.
- **Implemented design specs** (follow and keep current when changing their area):

| Area | Spec |
| --- | --- |
| Single-owner boundary (no multiplayer, accounts, voice, chat or presence; guarded by `tests/no-media.test.ts`) | [docs/single-owner.md](docs/single-owner.md) |
| Factory: API key, computers, sessions, credits, CI, AutoWiki, cloud workers | [docs/factory.md](docs/factory.md) |
| Linear: connection, tickets, autopilot and worker tools | [docs/linear.md](docs/linear.md) |
| Whiteboard: cards, live iframe bridge, marks and comments, Chromium renders | [docs/whiteboard.md](docs/whiteboard.md) |
| Setup & Subscriptions: Droid install and sign-in, welcome, DroidProxy, quota and model eligibility | [docs/subscriptions.md](docs/subscriptions.md) |
| Office MCP: worker tools for teams, subagents, visits, questions and Whiteboards | [docs/office-mcp.md](docs/office-mcp.md) |
| Mission Control: Orchestrator, external Tailscale bots, remote MCP | [docs/mission-control.md](docs/mission-control.md) |

## Repository map

Each directory with local rules carries its own `AGENTS.md`:

| Path | Role |
| --- | --- |
| `src/server/`, `src/server/office-mcp/` | Node daemon (CLI, workers, PTY host, hooks, boards, pipelines, floors) and Office MCP tools |
| `src/shared/` | Pure ES2022 types and logic shared by server and client (`protocol.ts`, `prompts.ts`, `layout.ts`) |
| `src/client/` | Vite companion: `ui/` (DOM modals and panels), `/dashboard` workspace |
| `src/desktop/`, `build/`, `electron-builder.yml` | Mac Electron companion, tray, updates, signing and packaging |
| `android/` | Kotlin/Compose phone and tablet companion (independent Gradle build) |
| `bin/`, `tests/`, `tools/`, `deploy/`, `docs/` | CLI entry, `node:test` suites, offline tools, AWS EC2 scripts, user guide and specs |

## Commands

Run from the repository root with npm (`package-lock.json` is the sole lockfile). Android commands live in [android/AGENTS.md](android/AGENTS.md).

- `npm ci`: clean install; `prepare` installs `.husky/pre-commit` and runs `npm run build`.
- `npm run dev`: Vite on `:5173` proxying to the watched server on `:4700`.
- `node bin/factory-flow.js <project>`: runs built `dist/` (run `npm run build` after source edits).
- `node --import tsx --test tests/<name>.test.ts`: runs a single test file.
- `.factory-flow.json` configures fresh worktree setup (`npm ci` after copying `/android/local.properties`); update it whenever a fresh clone needs another step or local file.

## Conventions

- Keep `.factory-flow/` (runtime config, workers, scrollback, worktrees) and `.env*` files untracked. A legacy `.droid-office.json` is read only as a fallback for `.factory-flow.json`. Update `.env.example` whenever adding, renaming or removing an env var (`tests/env-example.test.ts` enforces parity).
- The signed Mac app release (with the paired Android APK) is the only supported production distribution, and `package.json` stays `"private": true` (no standalone tarballs, installers or npm publishing).
- The Mac app ships unpacked (`asar: false`) and runs the office, PTY host and worker hooks on `process.execPath` with `ELECTRON_RUN_AS_NODE=1`. Route any new `process.execPath` script through `runAsNode` in `src/server/workers.ts` as a file on disk.
- Bump `version` in `package.json` only to start a new minor; CI releases every `main` merge as `v<major>.<minor>.<commit count>`.
- Prefix commit subjects with `feat:`, `fix:`, `docs:` or `chore:`. Fix everything `.husky/pre-commit` (`lint-staged` + `npm run typecheck`) reports rather than bypassing with `--no-verify`.
- `npm run lint` runs Oxlint (`.oxlintrc.json`) and Biome (`biome.jsonc`). Fix findings in source code; linter suppressions and rule-config edits are off the table.
- `npm run typecheck` uses the npm-locked `bun` binary across all three projects (`tests/typecheck-parity.test.ts`). After `npm ci --ignore-scripts`, run `npm rebuild bun` first.

## Companion parity

When a web companion (`/dashboard`) fix or feature applies to mobile, implement and verify the matching Android change in the same work. Centralize shared logic in `src/shared/` where practical; where platform boundaries prevent sharing, keep behavior aligned and tested on both sides.

## Testing the running office

Scale verification to risk: focused unit tests settle bounded logic changes; exercise the running office whenever a change surfaces in UI, rendering, IPC or live workflows.

- **Clone (`flow-clone` skill)**: default target for running-office checks, bug repros, and PR screenshots or video. Copies the owner's floors, Factory/Jira connections, Whiteboards and browser settings without touching `:4700`.
- **Owner's live office (`:4700` and paired adb devices)**: use when verifying web companion or Android changes directly against the owner's active setup.
- **PR end-to-end proof (`verify-factory-flow` skill)**: launches an isolated clone (or `--fresh` when no office is installed), drives the feature, and captures screenshots and transcripts.

Use real account state. When an item to show does not exist yet, create it through the product or API (with owner approval if it costs money or writes externally) and delete it afterwards; never substitute mocked, seeded or empty `git init` data. Unit-test stubs follow [tests/AGENTS.md](tests/AGENTS.md).

Test the Mac app only with a properly signed build (using `--user-data-dir`; see [src/desktop/AGENTS.md](src/desktop/AGENTS.md)) or an isolated browser. Never modify an `.app` bundle or copy, which breaks its signature and triggers macOS "app is damaged" warnings; report when neither option is available.

## Pushing and pull requests

Target `nikships/factory-flow` on `origin` for every push and PR:

```bash
gh pr create --repo nikships/factory-flow --base main
```

Always pass `--repo` and `--base` so the target is explicit rather than inferred from the checkout's remotes.

## Validation before a PR

Run the CI suite in order until all four pass:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
```

- **Server startup changes**: run the "Start the office from the checkout" smoke step from `.github/workflows/release.yml` locally.
- **Packaging or Mac app startup changes**: package and run the Electron startup smoke check locally before merging (packaging and notarization run only on `main`, on a GitHub-hosted `macos-26` runner; see [docs/guide/development.md](docs/guide/development.md#releases)).
- **New CI checks or platform inputs**: add the step in `.github/workflows/release.yml`, list its paths in both `push.paths` and `pull_request.paths`, and wire job routing in `.github/scripts/release-changes.mjs` (`checksFor`).

# Hire a worker

The owner hires a Droid with a task and model, or a plain Shell, from the companion sidebar. Workers have live terminals and stable desk identities, and sending one home frees its slot.

## Sub-features

- `hire-shell` hires a Shell with the sidebar button.
- `hire-terminal` opens its row and runs a command in its terminal.
- `hire-send-home` confirms removal and frees its slot.
- `hire-droid-dialog` opens the task and model picker without starting a paid turn.

## How to get to it (user POV)

- In `/dashboard` or the Mac window, use **Shell** or **Hire Droid**.
- Click a worker row to open its terminal; use **Send home** in the pane header.
- On Android, use the hire screen (see [Android Workers list](android-workers.md)).

## Driving it with drive.sh and Playwright

Preconditions: doctor passes, the selected floor has a free slot, and the worker limit allows hiring.

- **Shell journey.** Run `scripts/drive.sh "$RUN" .agents/skills/verify-factory-flow/scripts/steps/hire-shell.mjs hire-shell`. It clicks Shell, opens the new `button.dash-row-open[data-worker]`, types a unique marker command into `.xterm-screen`, verifies both terminal output and a file side effect, and sends the worker home.
- **Droid dialog.** Click the sidebar's Hire Droid button, inspect its task/model controls, then close it without submitting unless a real turn is authorized.
- **Evidence.** Require ordered screenshots, exit code 0 and `proof.json` with the worker id and exact marker/file contents.

## Gotchas

- Scratch Home has no Droid sign-in. A blocked setup state is not proof of a working Droid turn.
- Names are random; use `data-worker` rather than a hard-coded name.
- A Droid with a worktree has additional cleanup choices; a plain Shell does not.
- Send every test worker home, including after failed probes.

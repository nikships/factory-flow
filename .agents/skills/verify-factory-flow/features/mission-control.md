# Mission Control

The Orchestrator and external Tailscale bots appear in Mission Control on every floor without taking floor-worker slots. Their sessions and teams remain building-wide.

## Sub-features

- `mission-entry` opens the pinned Orchestrator row.
- `mission-shared` changes its shared settings and preserves them across floors.
- `mission-bots` opens real external bot cards.
- `mission-turn` prompts, answers a question and interrupts a real turn.
- `mission-team` hires on a named floor and receives the report.
- `mission-android` opens Home, conversation, Asks and notifications.

## How to get to it (user POV)

- Click the pinned Orchestrator row in the web/Mac companion, or press ⌘O.
- Settings → Orchestrator controls on/off, model, effort and conversation.
- Settings → Phone & web → Tailscale MCP manages external bots.
- Android Home → Mission Control opens the Orchestrator or a bot.

## Driving it with Playwright and adb

Preconditions: launch and doctor pass. Real turns need a reachable configured model and owner authorization for inference; bots need real provisioned identities.

- **Entry/settings.** Run `scripts/drive.sh "$RUN" .agents/skills/verify-factory-flow/scripts/steps/mission-control.mjs mission-control`. It opens the row and thread, toggles the shared setting and restores it. It sends no prompt.
- **Floor continuity.** Switch with `[data-floor]`, reopen the pinned row and check the same thread/team.
- **Live turn.** Request one short two-choice question without hiring. Answer it, require the reply, then stop a separate turn. Record untested paid paths as skipped.
- **Team.** With approval, request one cheap read-only worker on a named cloned floor. Require the worker in that floor, its report and the Orchestrator follow-up. Send it home.
- **Bots.** Open a real bot row and require its pane to say it runs externally, rather than showing a local terminal.
- **Android.** Use `Tags.kt` handles for Home, conversation, Asks and settings. Exercise completion notification navigation only on an isolated paired test device.

## Gotchas

- A scratch Home without sign-in is a valid blocked state, not a successful real turn.
- Building agents and floor workers have different MCP permissions.
- Cleanup must also stop the Orchestrator PTY host under the cloned office.
- New conversation preserves its team; turning it off stops only its own session.

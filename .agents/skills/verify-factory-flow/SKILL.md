---
name: verify-factory-flow
description: Verify companion, Office MCP and Android workflows on an isolated Factory Flow run using launch, doctor, drive and cleanup scripts, retaining screenshots and transcripts outside scratch state.
---

# Verify Factory Flow

Read [the feature map](features/README.md) and the relevant recipe. Build before launch; avoid rebuilding while tests or a running check read `dist/`.

## Launch and doctor

```bash
.agents/skills/verify-factory-flow/scripts/launch.sh
# Or --fresh for credential-free setup when no installed office is needed.
.agents/skills/verify-factory-flow/scripts/doctor.sh "$RUN"
```

Keep the printed `RUN` and `EVIDENCE`. Isolation includes a spare port (never 4700), scratch Home, floors and process group. Evidence must resolve outside `RUN`. Follow [flow-clone's account boundaries](../flow-clone/SKILL.md) for copied credentials.

Doctor checks listener ownership, `/` → HTTP 302, `/dashboard` → HTTP 200, anonymous MCP refusal, build freshness and browser-profile availability. Require zero failures before driving and after a failed or surprising drive.

## Drive

```bash
.agents/skills/verify-factory-flow/scripts/drive.sh "$RUN" .agents/skills/verify-factory-flow/scripts/steps/hire-shell.mjs hire-shell
```

The browser runner exposes `{ page, js, click, shot, waitFor, sleep, reload, log, out, url }`. Built-in steps cover Shell hire/terminal/removal, Shell MCP refusal and Mission Control entry/settings. `VERIFY_OUT` points to the drive's evidence directory.

Use accessible roles and `data-worker`/`data-floor` selectors. Settings switches support focus then Space. Assert results in code. A drive writes screenshots, `transcript.txt` and `exit-code`; feature steps also write `proof.json`. Capture the action and an independent result, such as a file written by a shell.

Mac-window checks require a properly signed app and isolated `--user-data-dir`, not checkout Electron. Android recipes remain in the feature map.

## Audit and clean up

Keep credentials, pairing links and tokens out of evidence. Inspect screenshots and proof before reporting success. Report unreachable paths with the attempted entry point and missing prerequisite.

```bash
.agents/skills/verify-factory-flow/scripts/cleanup.sh "$RUN"
```

Cleanup stops only the run's process group and socket-matched PTY hosts, saves its sanitized server log, removes scratch state and checks the port is free. Run it after failures too; clean up any approved external resources separately.

Done when doctor and the required drives pass, their evidence survives cleanup, and no process or resource created by the check remains. Update the feature map without implying that historical proof verifies a changed entry point.

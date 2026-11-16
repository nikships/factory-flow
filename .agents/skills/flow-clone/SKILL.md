---
name: flow-clone
description: Clone installed Factory Flow (or Droid Office) state and drive this checkout's companion on an isolated port with flow-run.mjs. Use for running-office checks, repros and screenshots without touching :4700.
---

# Test an isolated companion

1. Build this checkout with `npm ci` or `npm run build`.
2. Run `.agents/skills/flow-clone/scripts/clone-flow.sh`. Use `--office DIR` to choose installed state (a Factory Flow office, or a Droid Office one whose `.droid-office/` state is read and written into the scratch copy as `.factory-flow/`; the source is never written), or `--fresh` for a credential-free checkout clone. Keep its printed scratch path as `$T`.
3. Start `$T/start.sh` as a managed background process. It serves this checkout's `dist/`, binds a spare loopback port, and isolates Home and PTY state under `$T`.
4. Drive with `node .agents/skills/flow-clone/scripts/flow-run.mjs "$T" steps.mjs --out /tmp/companion-proof`. The runner seeds copied browser settings, waits for the dashboard floor list, runs the steps, records screenshots and page errors, and closes its browser. Without steps it saves `office.png`.
5. Stop the server and socket-matched PTY hosts under `$T`, verify its port is free, then remove only `$T`. Keep evidence outside `$T`.

For a complete launch/doctor/drive/cleanup lifecycle, use [verify-factory-flow](../verify-factory-flow/SKILL.md).

## Steps

Export a default async function. Helpers are `{ page, js, click, shot, waitFor, sleep, reload, log, out, url }`. Use visible buttons, accessible roles and `data-worker`/`data-floor` selectors.

```js
export default async ({ page, shot }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  await shot('settings');
};
```

## Isolation and accounts

The clone copies floors, Whiteboards, connections and preferences. It excludes workers, live sessions, PTY sockets and worktrees, disables Linear autopilot and clears issue links. Its scratch Home has no Droid sign-in.

Copies can still contain real account credentials. Read-only account checks are fine; get owner approval before external writes, paid turns or provisioning resources. Track and clean up every created resource. Use real account data when verifying account workflows, rather than substituting mocks or empty repositories.

For Mac-window verification, use a properly signed app with its own `--user-data-dir`. The browser runner refuses checkout Electron launches. Never alter an app bundle. Report signed-app checks as unverified when no matching signed build is available.

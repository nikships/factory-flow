// Opens the Orchestrator through the companion and verifies shared settings without starting a paid turn.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export default async ({ page, shot, out }) => {
  const row = page.locator('button.dash-row-open[data-worker="orchestrator"]');
  await row.waitFor();
  await row.click();
  const pane = page.locator('.dash-pane[aria-label$=": Orchestrator"]');
  await pane.locator('.worker-thread[aria-label="Orchestrator thread"]').waitFor();
  await shot('01-orchestrator');
  await page.locator('button[aria-label="Settings"]').click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: /Orchestrator/ }).click();
  const toggle = settings.getByRole('checkbox', { name: 'Orchestrator', exact: true });
  const before = await toggle.isChecked();
  try {
    await toggle.focus();
    await toggle.press('Space');
    assert.equal(await toggle.isChecked(), !before);
    await shot('02-shared-setting');
  } finally {
    if ((await toggle.isChecked()) !== before) {
      await toggle.focus();
      await toggle.press('Space');
    }
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
  }
  writeFileSync(path.join(out, 'proof.json'), `${JSON.stringify({ feature: 'mission-control', entry: 'companion row', restored: before }, null, 2)}\n`);
};

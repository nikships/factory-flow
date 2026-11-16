export async function hireShell({ page }) {
  const rows = page.locator('button.dash-row-open[data-worker]');
  const before = new Set(await rows.evaluateAll((es) => es.map((e) => e.dataset.worker)));
  await page.getByRole('button', { name: 'Shell', exact: true }).click();
  await page.waitForFunction((ids) => [...document.querySelectorAll('button.dash-row-open[data-worker]')].some((e) => !ids.includes(e.dataset.worker)), [...before]);
  const id = await rows.evaluateAll((es, ids) => es.find((e) => !ids.includes(e.dataset.worker))?.dataset.worker, [...before]);
  if (!id || before.has(id)) throw new Error('Shell hire produced no new worker row');
  const row = page.locator(`button.dash-row-open[data-worker="${id}"]`);
  await row.click();
  await page.locator('.xterm-screen').last().waitFor();
  return { id, label: await row.getAttribute('aria-label') };
}

export async function runShell({ page }, command) {
  await page.locator('.xterm-screen').last().click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

export async function sendShellHome({ page }, worker, beforeSend) {
  await page.locator(`button.dash-row-open[data-worker="${worker.id}"]`).click();
  await page.getByRole('button', { name: /Send home/ }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.waitFor();
  if (beforeSend) await beforeSend();
  await confirm.getByRole('button', { name: 'Send home', exact: true }).click();
  await page.locator(`button.dash-row-open[data-worker="${worker.id}"]`).waitFor({ state: 'detached' });
}

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { hireShell, runShell, sendShellHome } from './shell-journey.mjs';
import { resetProbe, shellQuote, waitForProbe } from './shell-probe.mjs';

export default async (helpers) => {
  const { page, out, shot, log } = helpers;
  const marker = `verify-${Date.now().toString(36)}`;
  const file = path.join(out, 'shell-wrote.txt');
  await shot('01-before-hire');
  const worker = await hireShell(helpers);
  try {
    await shot('02-shell-hired');
    resetProbe(file);
    await runShell(helpers, `printf '%s\\n' ${shellQuote(marker)} | tee ${shellQuote(file)}`);
    const content = await waitForProbe(file, (value) => value === marker);
    if (content !== marker) throw new Error(`Shell did not write ${marker}`);
    await page.waitForFunction((m) => [...document.querySelectorAll('.xterm-rows')].some((e) => e.textContent.includes(m)), marker);
    await shot('03-terminal-roundtrip');
    writeFileSync(path.join(out, 'proof.json'), `${JSON.stringify({ feature: 'hire-worker', worker, marker, file, content }, null, 2)}\n`);
    log(`Shell roundtrip: ${marker}`);
  } finally {
    await sendShellHome(helpers, worker, () => shot('04-send-home'));
  }
  await shot('05-worker-removed');
};

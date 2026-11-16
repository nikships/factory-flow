// Hires a Shell, has it call the Office MCP with its own office credentials (kept in its environment,
// never printed), records the HTTP status the office answered, then sends the Shell home.
//   .agents/skills/verify-factory-flow/scripts/drive.sh "$RUN" .agents/skills/verify-factory-flow/scripts/steps/mcp-shell-refusal.mjs mcp-shell
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { hireShell, runShell, sendShellHome } from './shell-journey.mjs';
import { assertMcpRefusal, resetProbe, shellQuote, waitForProbe } from './shell-probe.mjs';

export default async (helpers) => {
  const { page, shot, log, out } = helpers;
  const status = path.join(out, 'mcp-shell-status.txt');
  const worker = await hireShell(helpers);
  const call = [
    `curl -s -o /dev/null -w '%{http_code}\\n' -X POST "$FACTORY_FLOW_HOOK_URL/office/mcp"`,
    `-H "Authorization: Bearer $FACTORY_FLOW_HOOK_TOKEN" -H "x-factory-flow-worker-id: $FACTORY_FLOW_WORKER_ID"`,
    `-H 'content-type: application/json' -H 'accept: application/json, text/event-stream'`,
    `-d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | tee ${shellQuote(status)}`,
  ].join(' ');
  resetProbe(status);
  await runShell(helpers, call);
  const code = await waitForProbe(status, (value) => /^\d{3}$/.test(value));
  log(`step shell MCP call answered ${code || 'nothing'}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some((e) => e.textContent.includes('/office/mcp')));
  await shot('01-shell-mcp-call');

  await sendShellHome(helpers, worker);
  writeFileSync(path.join(out, 'proof.json'), `${JSON.stringify({ worker, status: code }, null, 2)}\n`);
  assertMcpRefusal(code);
};

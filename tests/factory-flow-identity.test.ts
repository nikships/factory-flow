import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { DEFAULT_PORT, defaultOfficeDir } from '../src/desktop/settings.js';
import { probePort } from '../src/desktop/office.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { syncOfficeMcpConnection } from '../src/server/office-mcp/index.js';
import { removeBundledSkills, SKILL_MARK } from '../src/server/subagents.js';
import { childEnv } from '../src/server/worker-runtime/process.js';
import { inspectCheckout, copiesFrom } from '../src/server/worktree-setup.js';
import { browsersPath } from '../src/server/whiteboard-browser.js';
import { planServe } from '../src/server/tailscale.js';

function temporary(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-flow-identity-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

test('Factory Flow defaults do not reuse the original app state, port or browser cache', (t) => {
  const dir = temporary(t);
  const port = process.env.PORT;
  delete process.env.PORT;
  try {
    const cfg = loadConfig(['--home', dir]);
    assert.equal(cfg.port, 4700);
    assert.equal(DEFAULT_PORT, 4700);
    assert.equal(cfg.dataDir, path.join(dir, '.factory-flow'));
    assert.equal(defaultOfficeDir('/home/test'), '/home/test/factory-flow');
    assert.equal(existsSync(path.join(dir, '.droid-office')), false);
    assert.equal(browsersPath({ platform: 'darwin', home: '/home/test', env: {} }), '/home/test/Library/Caches/factory-flow/browsers');
    assert.equal(planServe([], 'http://127.0.0.1:4711')?.port, 9443);
  } finally {
    if (port === undefined) delete process.env.PORT;
    else process.env.PORT = port;
  }
});

test('Droid Office settings are not fallback configuration and its worker credentials never escape to children', (t) => {
  const dir = temporary(t);
  const names = ['DROID_OFFICE_AGENT', 'DROID_OFFICE_WORKER_ID', 'DROID_OFFICE_HOOK_URL', 'DROID_OFFICE_HOOK_TOKEN', 'FACTORY_FLOW_AGENT'];
  const saved = names.map((name) => process.env[name]);
  try {
    for (const name of names.slice(0, -1)) process.env[name] = 'parent-office-value';
    delete process.env.FACTORY_FLOW_AGENT;
    assert.equal(loadConfig(['--home', dir]).agentCmd, 'droid');
    const child = childEnv();
    for (const name of names) assert.equal(child[name], undefined, name);
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

test('MCP enable, repair and disable preserve the Droid Office profile entry and user hooks', async (t) => {
  const dir = temporary(t);
  const file = path.join(dir, 'mcp.json');
  const original = {
    type: 'http',
    url: 'http://127.0.0.1:4601/office/mcp',
    oauth: false,
    headers: { Authorization: `Bearer \${DROID_OFFICE_HOOK_TOKEN}`, 'x-droid-office-worker-id': `\${DROID_OFFICE_WORKER_ID}`, 'x-droid-office-url': `\${DROID_OFFICE_HOOK_URL}` },
  };
  const settings = path.join(dir, 'settings.json');
  const hooks = '{"hooks":{"Stop":[{"hooks":[{"command":"original-office-hook"}]}]}}';
  writeFileSync(settings, hooks);
  writeFileSync(file, JSON.stringify({ custom: true, mcpServers: { 'droid-office': original } }));
  for (const [url, on] of [
    ['http://127.0.0.1:4701', true],
    ['http://127.0.0.1:4702', true],
    ['http://127.0.0.1:4702', false],
  ] as const) {
    assert.equal(await syncOfficeMcpConnection(file, url, on, async () => false), undefined);
    const config = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(config.mcpServers['droid-office'], original);
    assert.equal(config.custom, true);
    assert.equal(!!config.mcpServers['factory-flow'], on);
    if (on) assert.equal(config.mcpServers['factory-flow'].headers.Authorization, `Bearer \${FACTORY_FLOW_HOOK_TOKEN}`);
    assert.equal(readFileSync(settings, 'utf8'), hooks);
  }
});

test('legacy skill cleanup only recognizes Factory Flow names and ownership marks', (t) => {
  const dir = temporary(t);
  const originalMark = SKILL_MARK.replace('Factory Flow', 'Droid Office');
  for (const [name, mark] of [
    ['droid-office-subagents', originalMark],
    ['factory-flow-subagents', originalMark],
    ['droid-office-whiteboard', originalMark],
  ]) {
    const file = path.join(dir, name, 'SKILL.md');
    mkdirSync(path.dirname(file));
    writeFileSync(file, mark);
  }
  assert.deepEqual(removeBundledSkills(dir), []);
  for (const name of ['droid-office-subagents', 'factory-flow-subagents', 'droid-office-whiteboard']) assert.equal(readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8'), originalMark);
});

test('repository config falls back only when the Factory Flow config is absent', (t) => {
  const dir = temporary(t);
  writeFileSync(path.join(dir, '.droid-office.json'), '{"worktree":{"setup":"legacy setup","copy":["/.legacy"]}}');
  assert.deepEqual(inspectCheckout(dir).repo, { setup: 'legacy setup', copy: ['/.legacy'] });
  writeFileSync(path.join(dir, '.factory-flow.json'), '{"worktree":{"setup":"flow setup","copy":[]}}');
  assert.deepEqual(inspectCheckout(dir).repo, { setup: 'flow setup', copy: [] });
  writeFileSync(path.join(dir, '.factory-flow.json'), '{broken');
  assert.match(inspectCheckout(dir).repo!.error!, /valid JSON/);
  assert.deepEqual(copiesFrom(dir, []), []);
});

test('the Mac port probe never attaches to a running Droid Office dashboard', async (t) => {
  const server = createServer((_req, res) => res.end('<title>Droid Office</title>'));
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  assert.equal(await probePort((server.address() as AddressInfo).port), 'other');
});

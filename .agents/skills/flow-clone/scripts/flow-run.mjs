#!/usr/bin/env node
// Drives an isolated companion, seeds its browser settings, saves evidence, and closes the browser.
// Usage: flow-run.mjs <clone-dir> [steps.mjs] [--out DIR] [--size 1440x900] [--timeout 120]
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runnerOptions, runnerUrl } from './flow-run-options.mjs';

const opts = runnerOptions(process.argv.slice(2));
const [cloneDir, stepsFile] = opts.positional;
if (opts.help || !cloneDir) {
  console.log('Usage: flow-run.mjs <clone-dir> [steps.mjs] [--out DIR] [--size 1440x900] [--timeout 120]');
  process.exit(opts.help ? 0 : 1);
}
if (opts.source || opts.desktop) {
  console.error('flow-run: use the isolated browser runner, or test a properly signed Mac app with its own --user-data-dir; checkout Electron launches are not supported');
  process.exit(1);
}
const clone = path.resolve(cloneDir);
const start = path.join(clone, 'start.sh');
if (!existsSync(start)) throw new Error(`${clone} has no start.sh; create it with clone-flow.sh`);
const port = Number(/--port (\d+)/.exec(readFileSync(start, 'utf8'))?.[1]);
if (!port || port === 4700) throw new Error(`refusing port ${port || '?'}: only drive isolated clones`);
const url = runnerUrl(port, false);
const out = path.resolve(opts.out ?? path.join(clone, 'shots'));
mkdirSync(out, { recursive: true });
const [width, height] = opts.size.split('x').map(Number);
const steps = stepsFile ? (await import(pathToFileURL(path.resolve(stepsFile)).href)).default : undefined;
if (stepsFile && typeof steps !== 'function') throw new Error('steps must export a default function');

const roots = process.env.FACTORY_FLOW_BROWSERS_PATH ? [process.env.FACTORY_FLOW_BROWSERS_PATH] : [path.join(os.homedir(), 'Library/Caches/factory-flow/browsers'), path.join(os.homedir(), '.cache/factory-flow/browsers')];
let executablePath;
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const dir of readdirSync(root)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse()) {
    for (const sub of readdirSync(path.join(root, dir))) {
      const candidate = path.join(root, dir, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
      if (existsSync(candidate)) executablePath ??= candidate;
    }
  }
}
if (!executablePath) throw new Error(`no headless shell in ${roots.join(', ')}; run node bin/factory-flow.js browser install`);
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath, headless: true });
const close = async (code) => {
  await browser.close();
  process.exit(code);
};
process.once('SIGINT', () => void close(130));
process.once('SIGTERM', () => void close(143));
let code = 0;
let page;
const problems = [];
try {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const storage = path.join(clone, 'local-storage.json');
  if (existsSync(storage)) {
    await context.addInitScript(
      (settings) => {
        if (sessionStorage.getItem('flow-run.loaded')) return;
        for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, value);
        sessionStorage.setItem('flow-run.loaded', '1');
      },
      JSON.parse(readFileSync(storage, 'utf8')),
    );
  }
  page = await context.newPage();
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('dialog', (dialog) => void dialog.accept().catch((error) => problems.push(error.message)));
  const ready = () => page.locator('body.dashboard .dash-floor-chip[aria-current="page"]').waitFor({ timeout: opts.timeout * 1000 });
  const shot = async (name, selector) => {
    const file = path.resolve(out, `${String(name).replace(/\.png$/, '')}.png`);
    if (!file.startsWith(out + path.sep)) throw new Error('screenshot must stay inside out');
    if (selector) await page.locator(selector).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
    console.log(`shot ${file}`);
    return file;
  };
  const helpers = {
    page,
    url,
    out,
    shot,
    js: (fn, arg) => page.evaluate(fn, arg),
    log: (...args) => console.log(...args),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    click: (selector, text) => (text === undefined ? page.locator(selector) : page.locator(selector).filter({ hasText: text })).first().click(),
    waitFor: (fn, arg, timeout = 30_000) => page.waitForFunction(fn, arg, { timeout }),
    reload: async () => {
      await page.reload();
      await ready();
    },
  };
  try {
    await page.goto(url);
    await ready();
    console.log(`flow-run: companion ready on ${page.url()}`);
    if (steps) await steps(helpers);
    else await shot('office');
    if (problems.length) throw new Error(`page errors: ${problems.join('; ')}`);
  } catch (error) {
    code = 1;
    console.error(`flow-run: ${error.message}`);
    await shot('failure').catch(() => undefined);
  }
} catch (error) {
  code = 1;
  console.error(`flow-run: ${error.message}`);
} finally {
  await browser.close();
}
process.exitCode = code;

import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog } from 'electron';
import { checkRequirements, type Machine } from './requirements.js';
import { formatStartupFailure, type StartupFailure } from './startup-failure.js';

/** Set by CI and nothing else: the packaged app starts, checks and exits without a window or a dialog (`--startup-check`). */
const STARTUP_CHECK_FLAG = '--startup-check';

export function isStartupCheck(argv: readonly string[] = process.argv): boolean {
  return argv.includes(STARTUP_CHECK_FLAG);
}

function readMachine(): Machine {
  return { platform: process.platform, arch: process.arch, release: os.release() };
}

/** Thrown by `failStartup` after it has asked the app to exit: the startup code in flight must not carry on. */
export class StartupAborted extends Error {
  constructor(readonly failure: StartupFailure) {
    super(`startup failed: ${failure.kind}`);
  }
}

/** Appends a failure to `startup.log`; the log is a courtesy, the dialog is the report. */
export function logStartupFailure(failure: StartupFailure): void {
  try {
    const logs = app.getPath('logs');
    mkdirSync(logs, { recursive: true });
    appendFileSync(path.join(logs, 'startup.log'), `${new Date().toISOString()} [${failure.kind}] ${formatStartupFailure(failure)}\n\n`);
  } catch {
    // Nothing to do about a log that can't be written.
  }
}

/**
 * Shows why the app can't run and quits, with exit code 1. Every startup failure goes through here: the Mac app
 * has one way to draw, so a missing piece is an error the user reads, never a quieter mode. Call it once the app is
 * ready (a dialog needs that), and let its `StartupAborted` propagate to `main.ts`, which swallows it. With `--startup-check` it prints to stderr instead of opening a dialog.
 */
export function failStartup(failure: StartupFailure): never {
  const text = formatStartupFailure(failure);
  logStartupFailure(failure);
  if (isStartupCheck()) {
    process.stderr.write(`startup failure [${failure.kind}]: ${text}\n`);
  } else {
    dialog.showMessageBoxSync({ type: 'error', message: failure.title, detail: failure.detail, buttons: ['Quit'], defaultId: 0 });
  }
  app.exit(1);
  // app.exit() returns before the process is gone, so the caller must stop running at once.
  throw new StartupAborted(failure);
}

/** Refuses to go on unless this is macOS 14+ on Apple silicon on arm64. */
export function enforceRequirements(machine: Machine = readMachine()): void {
  const failure = checkRequirements(machine);
  if (failure) failStartup(failure);
}

export function runStartupCheck(): void {
  const machine = readMachine();
  const report = { arch: machine.arch, darwin: machine.release, electron: process.versions.electron };
  process.stdout.write(`startup-check ok: ${JSON.stringify(report)}\n`);
  app.exit(0);
}

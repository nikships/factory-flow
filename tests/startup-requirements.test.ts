import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRequirements, darwinMajor, type Machine, MIN_DARWIN, MIN_MACOS } from '../src/desktop/requirements.js';
import { formatStartupFailure } from '../src/desktop/startup-failure.js';
const GOOD: Machine = { platform: 'darwin', arch: 'arm64', release: '25.0.0' };
const on = (changes: Partial<Machine>): Machine => ({ ...GOOD, ...changes });
test('darwinMajor reads the kernel major version', () => {
  assert.equal(darwinMajor('23.6.0'), 23);
  assert.equal(darwinMajor('25.0.0'), 25);
  assert.equal(darwinMajor('nonsense'), undefined);
  assert.equal(darwinMajor(''), undefined);
});

test('macOS 14 is Darwin 23', () => {
  assert.equal(MIN_MACOS, 14);
  assert.equal(MIN_DARWIN, 23);
});

test('macOS before 14 is refused before the chip is looked at', () => {
  const failure = checkRequirements(on({ release: '22.6.0' }));
  assert.equal(failure?.kind, 'macos');
  assert.match(failure?.title ?? '', /macOS 14 or later/);
  assert.equal(checkRequirements(on({ release: '' }))?.kind, 'macos');
});

test('another platform is refused', () => {
  assert.equal(checkRequirements(on({ platform: 'linux' }))?.kind, 'platform');
});

test('all arm64 Macs pass, with no GPU or chip-tier gate', () => {
  for (const release of ['23.0.0', '24.1.0', '27.2.0']) assert.equal(checkRequirements(on({ release })), undefined);
  const intel = checkRequirements(on({ arch: 'x64' }));
  assert.equal(intel?.kind, 'chip');
  assert.match(formatStartupFailure(intel!), /arm64/);
});

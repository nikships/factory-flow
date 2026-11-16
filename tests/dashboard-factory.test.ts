import assert from 'node:assert/strict';
import test from 'node:test';
import { FACTORY_TABS, FACTORY_TAB_KEY, factoryTab, lastFactoryTab, rememberFactoryTab, sessionPulls } from '../src/client/dashboard-factory-model.js';
import { sessionOf, type FactorySession } from '../src/shared/factory-sessions.js';

test('Factory tab model has the five ordered tabs and rejects stale storage values', () => {
  assert.deepEqual(
    FACTORY_TABS.map(({ label }) => label),
    ['Computers', 'AutoWiki', 'Files', 'Sessions', 'CI'],
  );
  for (const { id } of FACTORY_TABS) assert.equal(factoryTab(id), id);
  for (const invalid of [null, undefined, '', 'constructor', 'Wiki', {}, 1]) assert.equal(factoryTab(invalid), 'computers');
});

test('Factory persists the last selected tab and tolerates blocked storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(lastFactoryTab(storage), 'computers');
  for (const { id } of FACTORY_TABS) {
    rememberFactoryTab(storage, id);
    assert.equal(values.get(FACTORY_TAB_KEY), id);
    assert.equal(lastFactoryTab(storage), id);
  }
  values.set(FACTORY_TAB_KEY, 'old-window');
  assert.equal(lastFactoryTab(storage), 'computers');
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(lastFactoryTab(blocked), 'computers');
  assert.doesNotThrow(() => rememberFactoryTab(blocked, 'files'));
});

// Artifact shapes follow the existing Factory sessions parser and its real API contract.
const session = (sessionId: string, artifacts: unknown[], updatedAt = 1): FactorySession => sessionOf({ sessionId, title: 'Task', status: 'idle', createdAt: 1, updatedAt, artifacts })!;

test('session PRs show only opened/merged pulls, newest first, deduplicated by URL', () => {
  const url = 'https://github.com/example/droid-office/pull/72';
  const first = session('first', [
    { id: 'created', kind: 'pull_request', action: 'create', url, createdAt: 10 },
    { id: 'issue', kind: 'issue', action: 'create', url: 'https://github.com/example/droid-office/issues/1', createdAt: 90 },
    { id: 'view', kind: 'pull_request', action: 'view', url: `${url}0`, createdAt: 80 },
    { id: 'unsafe', kind: 'pull_request', action: 'merge', url: 'javascript:alert(1)', createdAt: 100 },
    { id: 'missing', kind: 'pull_request', action: 'create' },
  ]);
  const second = session('second', [
    { id: 'merged', kind: 'pull_request', action: 'merge', url, createdAt: 20 },
    { id: 'reviewed', kind: 'pull_request', action: 'review', url, createdAt: 30 },
    { id: 'gitlab', kind: 'artifact', url: 'https://gitlab.com/group/repo/-/merge_requests/8', createdAt: 15 },
    { id: 'other', kind: 'artifact', url: 'https://factory.ai', createdAt: 50 },
  ]);
  assert.deepEqual(
    sessionPulls([first, second]).map(({ artifact }) => artifact.id),
    ['merged', 'gitlab'],
  );
  assert.equal(sessionPulls([first, second], 1)[0].session.id, 'second');
  assert.deepEqual(sessionPulls([first, second], 0), []);
  assert.equal(first.artifacts[0].id, 'created', 'input artifacts are never mutated');
});

test('session PRs accept equivalent API action names and use session time when needed', () => {
  const items = ['created', 'opened', 'merged'].map((action, index) => session(String(index), [{ id: action, kind: 'merge-request', action, url: `https://gitlab.com/group/repo/-/merge_requests/${index}` }], index + 10));
  assert.deepEqual(
    sessionPulls(items).map(({ artifact }) => artifact.id),
    ['merged', 'opened', 'created'],
  );
  assert.deepEqual(sessionPulls([]), []);
});

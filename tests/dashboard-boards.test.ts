import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOARD_TABS,
  BOARDS_REPLY_TYPES,
  badgeFor,
  boardTabLabel,
  boardsBadge,
  boardsPaletteEntries,
  failedLatestRuns,
  isBoardTab,
  loadBoardTab,
  pullNeedsAttention,
  saveBoardTab,
  stepBoardTab,
  tabAvailability,
  type BoardsContext,
} from '../src/client/dashboard-boards-model.js';
import { SETTINGS_CARDS, settingsCards } from '../src/shared/settings-nav.js';
import type { PipelineRun } from '../src/shared/pipelines.js';
import type { GhPull } from '../src/shared/protocol.js';

const ctx = (over: Partial<BoardsContext> = {}): BoardsContext => ({ plain: false, linear: { connected: false, team: false }, jira: { connected: false, epic: false }, ...over });

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

function pull(over: Partial<GhPull> = {}): GhPull {
  return {
    number: 1,
    title: 't',
    state: 'OPEN',
    isDraft: false,
    url: 'u',
    author: 'a',
    labels: [],
    reviewDecision: '',
    headRefName: 'h',
    baseRefName: 'main',
    createdAt: '',
    updatedAt: '',
    additions: 0,
    deletions: 0,
    checks: 'pass',
    body: '',
    closes: [],
    ...over,
  };
}

function run(id: number, workflow: string, state: PipelineRun['state'], minute: number): PipelineRun {
  const createdAt = new Date(Date.UTC(2026, 2, 1, 12, minute)).toISOString();
  return { id, number: id, workflow, title: '', state, status: state, event: 'push', branch: 'main', sha: 'abc', url: '', createdAt, updatedAt: createdAt };
}

test('the window has the five tabs in order and names pull requests the forge’s way', () => {
  assert.deepEqual([...BOARD_TABS], ['issues', 'pulls', 'pipelines', 'linear', 'jira']);
  assert.equal(boardTabLabel('pulls'), 'Pull requests');
  assert.equal(boardTabLabel('pulls', 'github'), 'Pull requests');
  assert.equal(boardTabLabel('pulls', 'gitlab'), 'Merge requests');
  assert.deepEqual(
    BOARD_TABS.map((t) => boardTabLabel(t)),
    ['Issues', 'Pull requests', 'Pipelines', 'Linear', 'Jira'],
  );
  assert.equal(isBoardTab('pipelines'), true);
  assert.equal(isBoardTab('wall'), false);
  assert.equal(isBoardTab(undefined), false);
});

test('forge tabs are ready on a git floor and say so on a plain folder, while Linear and Jira ask for a connection, then a team or epic', () => {
  for (const tab of ['issues', 'pulls', 'pipelines'] as const) {
    assert.deepEqual(tabAvailability(tab, ctx()), { kind: 'ready' });
    assert.deepEqual(tabAvailability(tab, ctx({ plain: true })), { kind: 'plain' });
  }
  assert.deepEqual(tabAvailability('linear', ctx()), { kind: 'connect', step: 'connection', card: 'Linear' });
  assert.deepEqual(tabAvailability('linear', ctx({ linear: { connected: true, team: false } })), { kind: 'connect', step: 'floor', card: "This floor's Linear team" });
  assert.deepEqual(tabAvailability('linear', ctx({ linear: { connected: true, team: true } })), { kind: 'ready' });
  assert.deepEqual(tabAvailability('jira', ctx()), { kind: 'connect', step: 'connection', card: 'Jira' });
  assert.deepEqual(tabAvailability('jira', ctx({ jira: { connected: true, epic: false } })), { kind: 'connect', step: 'floor', card: "This floor's Jira epic" });
  assert.deepEqual(tabAvailability('jira', ctx({ jira: { connected: true, epic: true } })), { kind: 'ready' });
  assert.deepEqual(tabAvailability('linear', ctx({ plain: true, linear: { connected: true, team: true } })), { kind: 'ready' });
});

test('every Settings card the empty states link to exists in the companion', () => {
  const titles = new Set<string>(settingsCards('companion').map((c) => c.title));
  const macTitles = new Set<string>(settingsCards('mac-companion').map((c) => c.title));
  for (const connected of [false, true])
    for (const tab of ['linear', 'jira'] as const) {
      const a = tabAvailability(tab, ctx({ linear: { connected, team: false }, jira: { connected, epic: false } }));
      assert.equal(a.kind, 'connect');
      if (a.kind === 'connect') {
        assert.ok(titles.has(a.card), a.card);
        assert.ok(macTitles.has(a.card), a.card);
        assert.equal(SETTINGS_CARDS.find((c) => c.title === a.card)?.pane, 'connections');
      }
    }
});

test('each floor remembers its own tab and falls back to Issues for anything unknown', () => {
  const storage = memory();
  assert.equal(loadBoardTab(storage, 'a'), 'issues');
  saveBoardTab(storage, 'a', 'pipelines');
  saveBoardTab(storage, 'b', 'jira');
  assert.equal(loadBoardTab(storage, 'a'), 'pipelines');
  assert.equal(loadBoardTab(storage, 'b'), 'jira');
  assert.equal(loadBoardTab(storage, 'c'), 'issues');
  assert.equal(loadBoardTab(storage, null), 'issues');
  storage.data.set('factory-flow.boards-tab.a', 'wall');
  assert.equal(loadBoardTab(storage, 'a'), 'issues');
  assert.equal(loadBoardTab(undefined, 'a'), 'issues');
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(loadBoardTab(blocked, 'a'), 'issues');
  assert.doesNotThrow(() => saveBoardTab(blocked, 'a', 'pulls'));
});

test('arrow keys step through the tabs and wrap', () => {
  assert.equal(stepBoardTab('issues', 1), 'pulls');
  assert.equal(stepBoardTab('issues', -1), 'jira');
  assert.equal(stepBoardTab('jira', 1), 'issues');
  assert.equal(stepBoardTab('pipelines', -1), 'pulls');
});

test('a pull request needs attention when it is open, not a draft, and failing or sent back', () => {
  assert.equal(pullNeedsAttention(pull()), false);
  assert.equal(pullNeedsAttention(pull({ checks: 'fail' })), true);
  assert.equal(pullNeedsAttention(pull({ reviewDecision: 'CHANGES_REQUESTED' })), true);
  assert.equal(pullNeedsAttention(pull({ checks: 'pending', reviewDecision: 'REVIEW_REQUIRED' })), false);
  assert.equal(pullNeedsAttention(pull({ checks: 'fail', isDraft: true })), false);
  assert.equal(pullNeedsAttention(pull({ checks: 'fail', state: 'MERGED' })), false);
});

test('only a workflow whose newest run failed counts as failed', () => {
  const runs = [run(1, 'CI', 'failure', 1), run(2, 'CI', 'success', 2), run(3, 'Release', 'success', 3), run(4, 'Release', 'failure', 4), run(5, 'Deploy', 'running', 5), run(6, 'Docs', 'cancelled', 6)];
  assert.deepEqual(
    failedLatestRuns(runs).map((r) => r.id),
    [4],
  );
  assert.deepEqual(failedLatestRuns([]), []);
});

test('the badge adds attention pull requests and failed workflows, and stays away when there is nothing, no data or a plain floor', () => {
  const pulls = [pull({ number: 1, checks: 'fail' }), pull({ number: 2 }), pull({ number: 3, reviewDecision: 'CHANGES_REQUESTED' })];
  const runs = [run(1, 'CI', 'failure', 1)];
  const badge = boardsBadge({ plain: false, pulls, runs });
  assert.equal(badge?.count, 3);
  assert.equal(badge?.pulls, 2);
  assert.equal(badge?.runs, 1);
  assert.equal(badge?.summary, '2 pull requests need attention, 1 run failed');
  assert.equal(boardsBadge({ plain: false, pulls: [pull({ checks: 'fail' })], forge: 'gitlab' })?.summary, '1 merge request needs attention');
  assert.equal(boardsBadge({ plain: false, runs: [run(1, 'CI', 'failure', 1), run(2, 'Docs', 'failure', 2)] })?.summary, '2 runs failed');
  assert.equal(boardsBadge({ plain: false, pulls: [pull()], runs: [run(1, 'CI', 'success', 1)] }), undefined);
  assert.equal(boardsBadge({ plain: false }), undefined);
  assert.equal(boardsBadge({ plain: true, pulls, runs }), undefined);
});

test('the badge counts a board only once it has loaded without an error', () => {
  const source = (over: object = {}) => ({
    plain: false,
    pulls: { items: [pull({ checks: 'fail' })], fetchedAt: 1, error: undefined as string | undefined },
    pipelines: { runs: [run(1, 'CI', 'failure', 1)], fetchedAt: 1, error: undefined as string | undefined },
    ...over,
  });
  assert.equal(badgeFor(source())?.count, 2);
  assert.equal(badgeFor(source({ pulls: { items: [pull({ checks: 'fail' })], fetchedAt: 0 } }))?.count, 1);
  assert.equal(badgeFor(source({ pulls: { items: [pull({ checks: 'fail' })], fetchedAt: 1, error: 'gh failed' } }))?.count, 1);
  assert.equal(badgeFor(source({ pipelines: { runs: [], fetchedAt: 1, error: 'no actions' } }))?.count, 1);
  assert.equal(badgeFor(source({ plain: true })), undefined);
});

test('⌘K gets one entry for each tab, each opening that tab', () => {
  const opened: string[] = [];
  const entries = boardsPaletteEntries((tab) => opened.push(tab));
  assert.deepEqual(
    entries.map((e) => e.id),
    BOARD_TABS.map((t) => `boards:${t}`),
  );
  assert.deepEqual(
    entries.map((e) => e.label),
    ['Boards: Issues', 'Boards: Pull requests', 'Boards: Pipelines', 'Boards: Linear', 'Boards: Jira'],
  );
  for (const e of entries) e.run();
  assert.deepEqual(opened, [...BOARD_TABS]);
  assert.equal(boardsPaletteEntries(() => {}, 'gitlab')[1].label, 'Boards: Merge requests');
  assert.ok(entries.every((e) => e.keywords?.length));
});

test('the companion routes every reply the boards and Settings wait on', () => {
  for (const type of ['gh.merged', 'gh.commented', 'gh.closed', 'gh.labeled', 'pipelines.done', 'pipelines.detail', 'linear.setup', 'jira.setup']) assert.ok(BOARDS_REPLY_TYPES.has(type), type);
  assert.equal(BOARDS_REPLY_TYPES.has('gh.pulls'), false);
});

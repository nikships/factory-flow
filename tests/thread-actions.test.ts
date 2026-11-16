import assert from 'node:assert/strict';
import test from 'node:test';
import { driveDroidRewind } from '../src/server/worker-rewind.js';
import { driveDroidSetting } from '../src/server/worker-settings.js';
import { effortName, modelOnScreen, readLiveScreen, readSideChat } from '../src/shared/thread-live.js';
import { readRewindFiles, readRewindMenu, readRewindRestore, rewindFileFor, rewindFileMatches, rewindFilesSince } from '../src/shared/thread-rewind.js';
import { threadCopyText, threadPrompts, threadTurns } from '../src/shared/thread-turns.js';
import type { ThreadEntry } from '../src/shared/worker-thread.js';

// Droid 1.12.1 at 120 columns, from the scratch-session captures.
const FILES = (rows: [selected: boolean, checked: boolean, label: string][]) => [
  '╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮',
  '│ Restore Files to Rewind Point                                                                                        │',
  '│                                                                                                                      │',
  '│ 1 of 1 edited file(s) selected for restoration.                                                                      │',
  '│ 1 of 1 created file(s) selected for deletion.                                                                        │',
  '│                                                                                                                      │',
  ...rows.map(([selected, checked, label]) => `${`│ ${selected ? '>' : ' '} [${checked ? 'x' : ' '}] ${label}`.padEnd(119)}│`),
  '│                                                                                                                      │',
  '│ Press R to apply changes, S to skip                                                                                  │',
  '╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯',
  '  ↑↓ navigate   Space/Enter toggle   A all   N none   R restore   S skip   Esc cancel   1-2 of 2',
];
const SIDE = [
  '           && echo done',
  ' ⠰ Executing...',
  '── Side chat ────────────────────────────────────────────────────────────────────────────────────────────── Esc close ──',
  '  what is 2+2',
  '  4',
  '',
  '› Ask a question…',
  '  Enter send   ⇧Enter newline   /clear start over',
];
const MENU = [
  ' ╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮',
  ' │ Select a user message to rewind before                                                                               │',
  ' │                                                                                                                      │',
  ' │ #     Message Preview                                                                                                │',
  ' │ > 4    Edit a.txt and create c.txt                                                                                   │',
  ' ╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯',
  '   ↑↓ to navigate   Enter to select   Esc/Q to close   Showing 1-1 of 1',
];
const RESTORE = (selected: number) =>
  [' ╭────────────────────────────────────────╮', ' │ Rewind File Restoration                │', ' │ This rewind point has 2 file change(s) that can be undone: │']
    .concat(['Restore all files', 'Choose files to restore...', "Don't restore files"].map((label, i) => ` │ ${i === selected ? '>' : ' '} ${label} │`))
    .concat([' ╰────────────────────────────────────────╯']);
const REWOUND = [' ●  Rewound conversation to before: "Edit a.txt and create c.txt"'];

test('Droid’s file chooser reads its rows, checks, sizes and range', () => {
  assert.deepEqual(
    readRewindFiles(
      FILES([
        [true, true, 'a.txt (6 B) restore'],
        [false, false, 'c.txt delete'],
      ]),
    ),
    {
      rows: [
        { path: 'a.txt', action: 'restore', checked: true, selected: true },
        { path: 'c.txt', action: 'delete', checked: false, selected: false },
      ],
      first: 1,
      last: 2,
      total: 2,
    },
  );
  assert.equal(readRewindFiles(MENU), undefined);
  assert.equal(rewindFileMatches('/Users/dev/project/src/a.txt', 'src/a.txt'), true);
  assert.equal(rewindFileMatches('./a.txt', 'a.txt'), true);
  assert.equal(rewindFileMatches('src/ba.txt', 'a.txt'), false);
  assert.equal(rewindFileMatches('', 'a.txt'), false);
  assert.equal(rewindFileFor(['/p/sub/a.txt', 'a.txt'], 'a.txt'), 'a.txt');
  assert.equal(rewindFileFor(['/p/sub/a.txt'], 'sub/a.txt'), '/p/sub/a.txt');
  assert.equal(rewindFileFor(['b.txt'], 'a.txt'), undefined);
  assert.equal(readRewindRestore([' │ Rewind File Restoration │']), undefined);
});

const tool = (id: string, seq: number, name: string, input: object, error = false): ThreadEntry => ({ id, seq, role: 'assistant', kind: 'tool', name, input: JSON.stringify(input), error });
const user = (id: string, seq: number, text: string): ThreadEntry => ({ id, seq, role: 'user', kind: 'text', text });
const reply = (id: string, seq: number, text: string): ThreadEntry => ({ id, seq, role: 'assistant', kind: 'text', text });

test('the files a rewind offers are those changed after the message, a created one deleted however often it was edited', () => {
  const entries = [
    tool('t0', 0, 'Edit', { file_path: '/p/early.ts', old_str: 'a', new_str: 'b' }),
    user('u1', 1, 'Change things'),
    tool('t1', 2, 'Create', { file_path: '/p/new.ts', content: 'x' }),
    tool('t2', 3, 'Edit', { file_path: '/p/a.ts', old_str: 'a', new_str: 'b' }),
    tool('t3', 4, 'Edit', { file_path: '/p/failed.ts', old_str: 'a', new_str: 'b' }, true),
    user('u2', 5, 'More'),
    tool('t4', 6, 'Edit', { file_path: '/p/new.ts', old_str: 'x', new_str: 'y' }),
  ];
  assert.deepEqual(
    rewindFilesSince(entries, 'u1').map(({ path, action }) => ({ path, action })),
    [
      { path: '/p/new.ts', action: 'delete' },
      { path: '/p/a.ts', action: 'restore' },
    ],
  );
  assert.deepEqual(
    rewindFilesSince(entries, 'u2').map(({ path, action }) => ({ path, action })),
    [{ path: '/p/new.ts', action: 'restore' }],
  );
  assert.deepEqual(rewindFilesSince(entries, 'missing'), []);
});

function chooserDroid({ start = 0, ignoreNone = false } = {}) {
  let phase: 'input' | 'menu' | 'restore' | 'files' | 'done' = 'input';
  let option = 0;
  let row = start;
  const checks = [true, true];
  const labels = ['a.txt (6 B) restore', 'c.txt delete'];
  const writes: string[] = [];
  return {
    writes,
    checks,
    get phase() {
      return phase;
    },
    write(data: string) {
      writes.push(data);
      if (phase === 'input' && data === '\r' && writes.includes('/rewind-conversation')) phase = 'menu';
      else if (phase === 'menu' && data === '\r') phase = 'restore';
      else if (phase === 'restore') {
        if (data === '\x1b[B') option = Math.min(2, option + 1);
        else if (data === '\x1b[A') option = Math.max(0, option - 1);
        else if (data === '\r') phase = option === 1 ? 'files' : 'done';
      } else if (phase === 'files') {
        if (data === 'n' && !ignoreNone) checks.fill(false);
        else if (data === ' ') checks[row] = !checks[row];
        else if (data === '\x1b[B') row = Math.min(1, row + 1);
        else if (data === '\x1b[A') row = Math.max(0, row - 1);
        else if (data === 'r' || data === 's') phase = 'done';
      }
    },
    rows() {
      if (phase === 'menu') return MENU;
      if (phase === 'restore') return RESTORE(option);
      if (phase === 'files') return FILES(labels.map((label, i) => [i === row, checks[i], label]));
      return phase === 'done' ? REWOUND : [];
    },
  };
}

test('choosing files clears Droid’s checks, checks only the wanted ones and applies them', async () => {
  const droid = chooserDroid();
  assert.deepEqual(readRewindMenu(MENU)?.rows[0].number, 4);
  assert.equal(readRewindRestore(RESTORE(1))?.[1].selected, true);
  const result = await driveDroidRewind(droid, { number: 4, preview: 'Edit a.txt and create c.txt' }, { files: ['/work/project/c.txt'] });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(droid.checks, [false, true]);
  assert.ok(droid.writes.includes('n'));
  assert.ok(droid.writes.includes('r'));
  assert.equal(droid.writes.at(-1), '\x15');
});

test('choosing files walks the list from its first row and unchecks what N left checked', async () => {
  const droid = chooserDroid({ start: 1, ignoreNone: true });
  const result = await driveDroidRewind(droid, { number: 4, preview: 'Edit a.txt and create c.txt' }, { files: ['c.txt'] });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(droid.checks, [false, true]);
});

test('a wanted file Droid does not list fails without applying anything', async () => {
  const droid = chooserDroid();
  const result = await driveDroidRewind(droid, { number: 4, preview: 'Edit a.txt and create c.txt' }, { files: ['b.txt'] });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /can’t restore b\.txt/);
  assert.ok(!droid.writes.includes('r'));
  assert.ok(droid.writes.includes('\x1b'));
});

test('choosing no files skips restoring and rewinds the conversation', async () => {
  const droid = chooserDroid();
  const result = await driveDroidRewind(droid, { number: 4, preview: 'Edit a.txt and create c.txt' }, { files: [] });
  assert.deepEqual(result, { ok: true });
  assert.ok(droid.writes.includes('s'));
  assert.deepEqual(droid.checks, [true, true]);
});

test('the side chat reads its question and answer, apart from the conversation under it', () => {
  assert.deepEqual(readSideChat(SIDE), { text: 'what is 2+2\n4' });
  assert.equal(readSideChat(SIDE.slice(0, 2)), undefined);
  // Closed: the rule stays in the scrollback with the main input box under it.
  assert.equal(readSideChat([...SIDE.slice(0, 5), '╭──────╮', '│ >    │', '╰──────╯']), undefined);
  assert.deepEqual(readSideChat(SIDE.map((line) => ` ${line}`)), { text: 'what is 2+2\n4' });
  assert.deepEqual(readLiveScreen(SIDE).side, { text: 'what is 2+2\n4' });
});

test('mode-line models split into their name and effort', () => {
  assert.deepEqual(modelOnScreen('Sonnet 5.5 (High)'), { name: 'Sonnet 5.5', effort: 'High' });
  assert.deepEqual(modelOnScreen(' Haiku 5.5 '), { name: 'Haiku 5.5' });
  assert.equal(effortName('xhigh'), 'Extra high');
  assert.equal(effortName('none'), 'Off');
  assert.equal(effortName('turbo'), 'turbo');
});

function tabDroid(efforts: (string | undefined)[], start = 0) {
  let at = start;
  const writes: string[] = [];
  return {
    writes,
    write(data: string) {
      writes.push(data);
      if (data === '\t') at = (at + 1) % efforts.length;
    },
    rows: () => [
      '⛬  Done.',
      '',
      ` Auto (High) · allow all commands                                                     Sonnet 5.5${efforts[at] ? ` (${efforts[at]})` : ''}`,
      '╭────────────────────────────────────╮',
      '│ >                                  │',
      '╰────────────────────────────────────╯',
    ],
  };
}

test('Tab cycles Droid’s reasoning effort until the mode line shows the one asked for', async () => {
  const droid = tabDroid(['High', 'Extra high', undefined, 'Low']);
  assert.equal(await driveDroidSetting(droid, { setting: 'effort', value: 'low' }), undefined);
  assert.equal(droid.writes.filter((data) => data === '\t').length, 3);
  const off = tabDroid(['High', undefined]);
  assert.equal(await driveDroidSetting(off, { setting: 'effort', value: 'none' }), undefined);
  assert.equal(off.writes.filter((data) => data === '\t').length, 1);
});

test('an effort already shown sends nothing, and a missing one stops after a full cycle', async () => {
  const held = tabDroid(['High', 'Low']);
  assert.equal(await driveDroidSetting(held, { setting: 'effort', value: 'high' }), undefined);
  assert.deepEqual(held.writes, []);
  const missing = tabDroid(['High', 'Low']);
  assert.equal(await driveDroidSetting(missing, { setting: 'effort', value: 'max' }), 'This model has no Max reasoning effort.');
  assert.equal(missing.writes.filter((data) => data === '\t').length, 9);
});

test('a dialog over the input box refuses before writing', async () => {
  const writes: string[] = [];
  const error = await driveDroidSetting({ write: (data) => writes.push(data), rows: () => MENU }, { setting: 'model', name: 'Haiku 5.5' });
  assert.equal(error, 'Droid has a dialog open. Close it in Raw TTY first.');
  assert.deepEqual(writes, []);
});

test('turns, prompt history and /copy read the conversation as Droid does', () => {
  const entries = [reply('a0', 0, 'Hello'), user('u1', 1, 'Fix the build'), reply('a1', 2, 'Looking'), reply('a2', 3, 'Fixed'), user('u2', 4, '  Thanks  '), user('u3', 5, 'Fix the build')];
  assert.deepEqual(threadTurns(entries), [
    { prompt: '', replies: ['Hello'] },
    { prompt: 'Fix the build', replies: ['Looking', 'Fixed'] },
    { prompt: 'Thanks', replies: [] },
    { prompt: 'Fix the build', replies: [] },
  ]);
  assert.deepEqual(threadPrompts(entries), ['Fix the build', 'Thanks']);
  assert.deepEqual(threadPrompts(entries, 1), ['Fix the build']);
  assert.equal(threadCopyText(entries, 'reply'), 'Looking\n\nFixed');
  assert.equal(threadCopyText(entries, 'prompt'), 'Fix the build');
  assert.equal(threadCopyText(entries, 'session', { sessionId: 's1' }), 's1');
  assert.equal(threadCopyText(entries, 'session'), undefined);
  assert.equal(threadCopyText(entries, 'turns', { turns: 2 }), 'User: Thanks\n\nUser: Fix the build');
  assert.equal(threadCopyText(entries, 'transcript'), 'Droid: Hello\n\nUser: Fix the build\n\nDroid: Looking\n\nDroid: Fixed\n\nUser: Thanks\n\nUser: Fix the build');
  assert.equal(threadCopyText([], 'transcript'), undefined);
});

const REWOUND_LINE = '●  Rewound conversation to before: "Use the Edit tool to change rewind-probe/a.txt from alpha to beta, then use the Create to…"';
const inputBox = (model: string) => [
  REWOUND_LINE,
  ` Auto (Med) · allow reversible commands                                                Haiku 5.5 (High)`.replace('Haiku 5.5 (High)', model),
  '╭────────────────────────────────────╮',
  '│ >                                  │',
  '╰────────────────────────────────────╯',
];
const LEGACY = (keep: boolean) => [
  REWOUND_LINE,
  '',
  '╭──────────────────────────────────────────────────╮',
  '│                                                  │',
  '│ This model is no longer the latest version       │',
  '│                                                  │',
  '╰──────────────────────────────────────────────────╯',
  `${keep ? ' ' : '>'} Switch to latest (Sonnet 5.5)`,
  `${keep ? '>' : ' '} Keep using legacy`,
  'Enter to confirm · Esc to cancel',
];
const PICKER = (rows: string[], selected: number) => [
  '╭──────────────────────────────────────────────────╮',
  '│ Select Model For This Session                    │',
  '│                                                  │',
  '│ ◉ Main | ○ Spec                                  │',
  '│                                                  │',
  '│ Sonnet 4.5                                       │',
  ...rows.map((row, i) => `${`│ ${i === selected ? '>' : ' '} ${row}`.padEnd(51)}│`),
  '│ Multipliers represent cost in Standard Credits   │',
  '╰──────────────────────────────────────────────────╯',
];

test('a transcript line or a dialog box above the input is never read as the mode line', () => {
  assert.equal(readLiveScreen(inputBox('Haiku 5.5 (High)')).model, 'Haiku 5.5 (High)');
  assert.equal(readLiveScreen(inputBox('Haiku 5.5 (High)')).spec, false);
  assert.equal(readLiveScreen(inputBox('DroidProxy: GPT 6.1 Sol (High)')).model, 'DroidProxy: GPT 6.1 Sol (High)', 'a BYOK model names its gateway before a colon');
  const dialog = readLiveScreen(LEGACY(false));
  assert.equal(dialog.model, undefined);
  assert.equal(dialog.spec, undefined);
});

test('a superseded model the owner picked is kept rather than swapped for the newer one', async () => {
  let screen = inputBox('Haiku 5.5 (High)');
  let phase: 'input' | 'picker' | 'legacy' | 'done' = 'input';
  let filtered = false;
  let selected = -1;
  let keep = false;
  const writes: string[] = [];
  const io = {
    write(data: string) {
      writes.push(data);
      if (phase === 'input' && data === '\r' && writes.includes('/model')) phase = 'picker';
      else if (phase === 'picker' && data === 'Sonnet 4.5') filtered = true;
      else if (phase === 'picker' && data === '\x1b[B') selected++;
      else if (phase === 'picker' && data === '\r' && selected === 0) phase = 'legacy';
      else if (phase === 'legacy' && data === '\x1b[B') keep = true;
      else if (phase === 'legacy' && data === '\r') phase = keep ? 'done' : 'input';
      screen = phase === 'picker' ? PICKER(filtered ? ['Sonnet 4.5  1.2×'] : ['Haiku 5.5  0.4×', 'Sonnet 4.5  1.2×'], selected) : phase === 'legacy' ? LEGACY(keep) : phase === 'done' ? inputBox('Sonnet 4.5 (High)') : screen;
    },
    rows: () => screen,
  };
  assert.equal(await driveDroidSetting(io, { setting: 'model', name: 'Sonnet 4.5' }), undefined);
  assert.equal(phase, 'done');
  assert.ok(keep, 'Keep using legacy was chosen');
});

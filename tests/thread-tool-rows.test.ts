import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactDiffRows, type ThreadDiffLine } from '../src/shared/thread-diff.js';
import { presentThread, threadList, threadToolName, threadToolPath, type ThreadModelAction, type ThreadSegment } from '../src/shared/thread-presentation.js';
import type { ThreadEntry } from '../src/shared/worker-thread.js';

const tool = (id: string, name: string, input: Record<string, unknown> = {}, extra: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id,
  seq: Number(id.replace(/\D/g, '')) || 0,
  role: 'assistant',
  kind: 'tool',
  name,
  input: JSON.stringify(input),
  output: 'Done',
  ...extra,
});
const thought = (id: string): ThreadEntry => ({ id, seq: Number(id.replace(/\D/g, '')) || 0, role: 'assistant', kind: 'thinking', text: 'Considering the next step' });
const activity = (entries: ThreadEntry[], busy = false) => {
  const row = presentThread(entries, busy).find((candidate) => candidate.kind === 'activity');
  assert.ok(row?.kind === 'activity');
  return row;
};
const actions = (entries: ThreadEntry[]): ThreadModelAction[] => activity(entries).blocks.flatMap((block) => (block.kind === 'tools' ? block.actions : []));
const segments = (entries: ThreadEntry[], busy = false): ThreadSegment[] => activity(entries, busy).segments ?? [];

test('tool rows use Factory verbs, subjects, icons, and failure copy', () => {
  const [read, grep, execute, edit, ask, memory, fetch, multi, del] = actions([
    tool('r1', 'Read', { file_path: '/repo/src/client/ui/thread.ts', offset: 20, limit: 80 }),
    tool('g2', 'Grep', { pattern: 'renderThreadActivity', path: '/repo/src/client' }),
    tool('e3', 'Execute', { command: 'npm test', summary: 'run the thread tests.' }, { error: true }),
    tool('e4', 'Edit', { file_path: '/repo/src/a.ts', old_str: 'old', new_str: 'new' }),
    tool('a5', 'AskUser', { questions: [{ question: 'One?' }, { question: 'Two?' }] }),
    tool('m6', 'memory___recall', { query: 'Thread rows' }),
    tool('f7', 'FetchUrl', { url: 'https://factory.ai/docs' }),
    tool('m8', 'MultiEdit', { file_path: '/repo/src/a.ts', old_str: 'old', new_str: 'new' }),
    tool('d9', 'Delete', { file_path: '/repo/src/old.ts' }),
  ]);
  assert.deepEqual([read.icon, read.verb, read.subject], ['read', 'Read', '.../client/ui/thread.ts, offset: 20, limit: 80']);
  assert.deepEqual([grep.icon, grep.verb, grep.subject], ['search', 'Grepped for', '"renderThreadActivity" in .../repo/src/client']);
  assert.deepEqual([execute.icon, execute.verb, execute.subject, execute.failedLabel], ['terminal', '', 'Run the thread tests', 'Command failed']);
  assert.deepEqual([edit.icon, edit.verb, edit.subject, edit.failedLabel], ['edit', 'Edit 2 lines', 'a.ts', 'Error editing file']);
  assert.equal(ask.verb, 'Asked user 2 questions');
  assert.equal(memory.icon, 'memory');
  assert.equal(fetch.icon, 'link');
  assert.equal(multi.icon, 'patch');
  assert.deepEqual([del.icon, del.verb, del.subject], ['delete', 'Delete file', 'old.ts']);
  assert.equal(threadToolPath('/repo/src/client/ui/thread.ts'), '.../client/ui/thread.ts');
  assert.equal(threadToolName('factory-flow'), 'Factory Flow');
  assert.equal(threadToolName('TaskStop'), 'Task Stop');
  assert.equal(threadList(['Memory', '2 searches', 'thought 1 time']), 'Memory, 2 searches, and thought 1 time');
});

test('exploration tools and thoughts fold into one summary, live only at the working tail', () => {
  const entries = [tool('r1', 'Read', { file_path: '/repo/a.ts' }), thought('t2'), tool('g3', 'Grep', { pattern: 'foo' })];
  assert.deepEqual(segments(entries), [
    {
      kind: 'explore',
      id: 'explore:r1',
      blockIds: ['tools:r1', 't2', 'tools:g3'],
      actionIds: ['r1', 'g3'],
      action: 'Explored',
      details: '2 searches and thought 1 time',
      live: false,
      open: false,
    },
  ]);
  const live = segments(entries, true)[0];
  assert.deepEqual(live?.kind === 'explore' && [live.action, live.details, live.live, live.open], ['Exploring', '2 searches and thinking', true, true]);
  assert.equal(segments([tool('r1', 'Read'), tool('r2', 'Read')])[0]?.kind === 'explore' && segments([tool('r1', 'Read'), tool('r2', 'Read')])[0].details, '2 files');
  assert.deepEqual(segments([thought('t1')]), [{ kind: 'thought', blockId: 't1' }]);
});

test('AskUser counts current questionnaire markers as well as legacy arrays', () => {
  const questionnaire = '1. [question] Pick a mode\n[topic] Mode\n[option] Auto\n[option] Spec\n\n2. [question] Which checks? (multi)\n[topic] Checks\n[option] Web\n[option] Android';
  const [current, pending] = actions([tool('a1', 'AskUser', { questionnaire }), tool('a2', 'AskUser', { questionnaire }, { output: undefined })]);
  assert.equal(current.verb, 'Asked user 2 questions');
  assert.equal(pending.verb, 'Asking user 2 questions');
});

test('repeating command summaries and five or more subagents fold into Factory groups', () => {
  const repeated = ['x1', 'x2', 'x3', 'x4'].map((id, index) => tool(id, 'Execute', { command: `npm run ${index}`, summary: index % 2 ? 'build it' : 'test it' }));
  assert.deepEqual(segments(repeated), [{ kind: 'repeat', id: 'repeat:x1', actionIds: ['x1', 'x2', 'x3', 'x4'], summaries: ['Test it', 'Build it'], times: 2, live: false, open: false }]);
  const liveRepeat = segments(repeated, true)[0];
  assert.deepEqual(liveRepeat?.kind === 'repeat' && [liveRepeat.live, liveRepeat.open], [true, true]);

  const delegated = ['t1', 't2', 't3', 't4', 't5'].map((id) => tool(id, 'Task', { subagent_type: 'explorer', description: `Inspect ${id}` }));
  const group = segments(delegated)[0];
  assert.deepEqual(group?.kind === 'tasks' && [group.label, group.settled, group.failed, group.live, group.open], ['Ran 5 explorer subagents', 5, 0, false, true]);
  const running = segments([...delegated.slice(0, 4), { ...delegated[4], output: undefined }], true)[0];
  assert.deepEqual(running?.kind === 'tasks' && [running.label, running.settled, running.live], ['Running 5 explorer subagents', 4, true]);
  assert.equal(segments([tool('h6', 'factory-flow___team_hire', { title: 'Delegate this' })])[0]?.kind, 'tool', 'office delegation calls stay out of connector exploration groups');
});

const line = (kind: ThreadDiffLine['kind'], newLine: number, text = `line ${newLine}`): ThreadDiffLine => ({ kind, text, newLine, ...(kind === 'del' ? { oldLine: newLine } : {}) });

test('compactDiffRows keeps one context line and names each hidden run', () => {
  const rows = compactDiffRows([
    { kind: 'hunk', text: '@@' },
    line('ctx', 1),
    line('ctx', 2),
    line('del', 3, 'old'),
    line('add', 3, 'new'),
    line('ctx', 4),
    line('ctx', 5),
    line('ctx', 6),
    line('ctx', 7),
    line('del', 8, 'old 8'),
    line('add', 8, 'new 8'),
    line('ctx', 9),
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === 'hidden' ? `hidden:${row.count}` : `${row.line.kind}:${row.line.newLine}`)),
    ['hidden:1', 'ctx:2', 'del:3', 'add:3', 'ctx:4', 'hidden:2', 'ctx:7', 'del:8', 'add:8', 'ctx:9'],
  );
});

test('compactDiffRows trims blank ends and counts the gap between numbered hunks', () => {
  const rows = compactDiffRows([
    { kind: 'hunk', text: '@@' },
    line('ctx', 1, ''),
    line('ctx', 1, ''),
    line('del', 2, 'old'),
    line('add', 2, 'new'),
    { kind: 'hunk', text: '@@' },
    line('ctx', 6),
    line('del', 7, 'old 7'),
    line('add', 7, 'new 7'),
    line('ctx', 8, ''),
    line('ctx', 8, ''),
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === 'hidden' ? `hidden:${row.count}` : `${row.line.kind}:${row.line.newLine}`)),
    ['del:2', 'add:2', 'hidden:3', 'ctx:6', 'del:7', 'add:7'],
  );
});

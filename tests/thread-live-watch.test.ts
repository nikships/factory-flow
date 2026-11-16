import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { threadPageDigest, ThreadWatchHub, type ThreadWatchMsg, type WatchedThreadTarget } from '../src/server/thread-watch.js';
import { WorkerThreadReader } from '../src/server/worker-thread.js';
import type { ThreadLive } from '../src/shared/thread-live.js';

const waitUntil = async (predicate: () => boolean) => {
  const end = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for a thread message');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
};
const liveState = (rev: number, label?: string): ThreadLive => ({ rev, at: 1000 + rev, status: 'idle', working: 'idle', ...(label ? { label } : {}), tools: [], settings: { model: 'claude-haiku-5-5' } });

test('snapshot digests notice entry times and a Task child discovered after the call', () => {
  const base = { sessionId: 's1', entries: [{ id: 'tool:c1', role: 'assistant' as const, kind: 'tool' as const, name: 'Task', seq: 0 }], hasMore: false };
  const initial = threadPageDigest(base, false);
  assert.equal(threadPageDigest(base, false), initial);
  assert.notEqual(threadPageDigest(base, true), initial);
  assert.notEqual(threadPageDigest({ ...base, entries: [{ ...base.entries[0], at: 100 }] }, false), initial);
  assert.notEqual(threadPageDigest({ ...base, entries: [{ ...base.entries[0], doneAt: 200 }] }, false), initial);
  assert.notEqual(threadPageDigest({ ...base, entries: [{ ...base.entries[0], tookMs: 20 }] }, false), initial);
  assert.notEqual(threadPageDigest({ ...base, entries: [{ ...base.entries[0], child: 'child-session' }] }, false), initial);
});

test('watch starts with idle live settings and a repaint pushes a changed live state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-live-watch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const source = { sessionId: 'session-one', cwd };
  const dir = path.join(root, cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${source.sessionId}.jsonl`), `${JSON.stringify({ type: 'session_start', id: source.sessionId, cwd })}\n`);
  const target: WatchedThreadTarget = { kind: 'local', floorId: null, busy: false, local: source };
  const sent: ThreadWatchMsg[] = [];
  let current = liveState(1);
  const hub = new ThreadWatchHub({
    workerThreads: new WorkerThreadReader(root),
    resolveWorker: () => target,
    live: async () => current,
    send: (_client, msg) => sent.push(msg),
    localCoalesceMs: 10,
  });
  t.after(() => hub.close());
  hub.watch('client', 'worker', true);
  await waitUntil(() => sent.some((msg) => msg.t === 'thread.live'));
  const first = sent.find((msg) => msg.t === 'thread.live');
  assert.ok(first?.t === 'thread.live');
  assert.equal(first.live.settings?.model, 'claude-haiku-5-5');
  assert.equal(first.live.status, 'idle');
  const count = sent.filter((msg) => msg.t === 'thread.live').length;
  hub.notifyWorker('worker');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sent.filter((msg) => msg.t === 'thread.live').length, count, 'the same rev is not pushed again');
  current = liveState(2, 'Streaming...');
  hub.screenChanged('worker');
  await waitUntil(() => sent.some((msg) => msg.t === 'thread.live' && msg.live.rev === 2));
});

test('new and returning clients receive unchanged live settings without duplicating existing clients', async (t) => {
  const page = { sessionId: 'session-one', entries: [], hasMore: false };
  let computations = 0;
  const sent: { clientId: string; msg: ThreadWatchMsg }[] = [];
  const target: WatchedThreadTarget = { kind: 'local', floorId: null, busy: false, local: { sessionId: page.sessionId, cwd: '/tmp/thread-live-watch' } };
  const hub = new ThreadWatchHub({
    workerThreads: {
      read: async () => page,
      sessionPaths: async () => undefined,
      sessionPathsSync: () => undefined,
      childSession: async () => undefined,
    },
    resolveWorker: () => target,
    live: async () => {
      computations++;
      return liveState(1);
    },
    send: (clientId, msg) => sent.push({ clientId, msg }),
    localCoalesceMs: 1,
  });
  t.after(() => hub.close());
  const deliveries = (clientId: string) => sent.filter((event) => event.clientId === clientId && event.msg.t === 'thread.live');
  hub.watch('android', 'worker', true);
  await waitUntil(() => deliveries('android').length === 1);
  hub.watch('web', 'worker', true);
  await waitUntil(() => deliveries('web').length === 1);
  assert.equal(deliveries('android').length, 1);
  const web = deliveries('web')[0].msg;
  assert.ok(web.t === 'thread.live');
  assert.equal(web.live.settings?.model, 'claude-haiku-5-5');

  const before = computations;
  hub.notifyWorker('worker');
  await waitUntil(() => computations > before);
  assert.equal(deliveries('android').length, 1);
  assert.equal(deliveries('web').length, 1);

  hub.watch('web', 'worker', false);
  hub.watch('web', 'worker', true);
  await waitUntil(() => deliveries('web').length === 2);
  assert.equal(deliveries('android').length, 1);
});

test('main and child watches push separate snapshots, with child echoed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-child-watch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const source = { sessionId: 'session-one', cwd };
  const child = '0b3a5f1e-7c1d-4d55-9a9e-2f8c7a6b5c4d';
  const dir = path.join(root, cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = (id: string, text: string) => ({ type: 'message', id, timestamp: '2026-11-15T03:58:31.089Z', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  await writeFile(path.join(dir, `${source.sessionId}.jsonl`), `${JSON.stringify({ type: 'session_start', id: source.sessionId, cwd })}\n${JSON.stringify(row('parent', 'Parent'))}\n`);
  await writeFile(path.join(dir, `${child}.jsonl`), `${JSON.stringify({ type: 'session_start', id: child, callingSessionId: source.sessionId, callingToolUseId: 'call-task' })}\n${JSON.stringify(row('child', 'Child'))}\n`);
  const target: WatchedThreadTarget = { kind: 'local', floorId: null, busy: false, local: source };
  const sent: ThreadWatchMsg[] = [];
  const hub = new ThreadWatchHub({ workerThreads: new WorkerThreadReader(root), resolveWorker: () => target, send: (_client, msg) => sent.push(msg), localCoalesceMs: 10 });
  t.after(() => hub.close());
  hub.watch('client', 'worker', true);
  hub.watch('client', 'worker', true, child);
  await waitUntil(() => sent.filter((msg) => msg.t === 'thread.snapshot').length >= 2);
  const snapshots = sent.filter((msg) => msg.t === 'thread.snapshot');
  assert.ok(snapshots.some((msg) => msg.t === 'thread.snapshot' && !msg.child && msg.entries[0]?.text === 'Parent'));
  assert.ok(snapshots.some((msg) => msg.t === 'thread.snapshot' && msg.child === child && msg.sessionId === child && msg.entries[0]?.text === 'Child'));
  hub.watch('client', 'worker', false, child);
  assert.equal(hub.watchedCount('client'), 1, 'turning off the child leaves the main watch');
});

test('one client seeding after a session change never suppresses the push to other watchers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-multi-seed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const dir = path.join(root, cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
  await mkdir(dir, { recursive: true });
  const write = async (sid: string, text: string) => {
    await writeFile(path.join(dir, `${sid}.jsonl`), `${JSON.stringify({ type: 'session_start', id: sid, cwd })}\n${JSON.stringify({ type: 'message', id: `m-${sid}`, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
  };
  await write('s1', 'Before rewind');
  let sessionId = 's1';
  const reader = new WorkerThreadReader(root);
  const sent: { client: string; msg: ThreadWatchMsg }[] = [];
  const hub = new ThreadWatchHub({
    workerThreads: reader,
    resolveWorker: () => ({ kind: 'local', floorId: null, busy: false, local: { sessionId, cwd } }),
    send: (client, msg) => sent.push({ client, msg }),
    localCoalesceMs: 30,
  });
  t.after(() => hub.close());
  hub.watch('web', 'worker', true);
  hub.watch('android', 'worker', true);
  await waitUntil(() => sent.filter((s) => s.client === 'android' && s.msg.t === 'thread.snapshot').length === 1);

  await write('s2', 'After rewind');
  sessionId = 's2';
  hub.notifyWorker('worker');
  const page = await reader.read({ sessionId: 's2', cwd }, undefined, false);
  hub.seed('worker', page, false, undefined, 'web');

  await waitUntil(() => sent.some((s) => s.client === 'android' && s.msg.t === 'thread.snapshot' && s.msg.sessionId === 's2'));
});

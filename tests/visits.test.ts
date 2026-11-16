import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_REPLY_MS, URGENT_WAIT_MS, Visits, independent, waitWords, type VisitWorkers } from '../src/server/visits.js';
import type { DroidScreen } from '../src/server/droid-screen.js';
import { Team, type TeamWorkers } from '../src/server/team.js';
import { SUBAGENT_DEFAULTS, type AgentChoice, type ServerMsg, type WorkerInfo, type WorkerStatus } from '../src/shared/protocol.js';
import type { Visit } from '../src/shared/visits.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function worker(over: Partial<WorkerInfo> & { id: string; deskId: string }): WorkerInfo {
  return { kind: 'agent', name: over.id, color: '#fff', status: 'done', acked: true, createdBy: 'test', createdAt: 0, cols: 100, rows: 30, open: false, ...over };
}

class Fake implements VisitWorkers {
  ws = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  resumed: { id: string; text: string }[] = [];
  /** Every Escape the office sent to cancel a turn. */
  escapes: string[] = [];
  /** Escapes and prompts in the order they went in, with the clock: what the host's terminal got. */
  keys: { id: string; key: 'escape' | 'prompt'; at: number }[] = [];
  /** What each host's screen shows; by default droid's spinner while it works, its input box otherwise. */
  screens = new Map<string, DroidScreen | undefined>();
  tails = new Map<string, string>();
  refuse?: string;
  clock = () => 0;
  add(w: WorkerInfo) {
    this.ws.set(w.id, w);
    return w;
  }
  list() {
    return [...this.ws.values()];
  }
  get(id: string) {
    return this.ws.get(id);
  }
  tail(id: string, lines: number) {
    const t = this.tails.get(id);
    return t === undefined ? undefined : t.split('\n').slice(-lines).join('\n');
  }
  prompt(id: string, text: string) {
    if (this.refuse) return this.refuse;
    this.typed.push({ id, text });
    this.keys.push({ id, key: 'prompt', at: this.clock() });
    const w = this.ws.get(id);
    if (w) w.lastInputAt = this.clock();
    return undefined;
  }
  refuseResume?: string;
  resume(id: string, text: string) {
    if (this.refuseResume) return this.refuseResume;
    this.resumed.push({ id, text });
    return undefined;
  }
  turnScreen(id: string) {
    if (this.screens.has(id)) return this.screens.get(id);
    return this.ws.get(id)?.status === 'working' ? 'busy' : 'idle';
  }
  /** As WorkerManager.cancelTurn: only a host that works and shows the spinner gets Escape. */
  cancelTurn(id: string) {
    if (this.ws.get(id)?.status !== 'working' || this.turnScreen(id) !== 'busy') return false;
    this.escapes.push(id);
    this.keys.push({ id, key: 'escape', at: this.clock() });
    return true;
  }
}

type Reply = { status: number; body: Record<string, any> };

function rig(t: { after(fn: () => void): void }) {
  const fake = new Fake();
  let clock = 1_000_000;
  fake.clock = () => clock;
  // Pixel and Nibble were hired by the owner; Byte is Pixel's subagent; Dot is another independent worker.
  fake.add(worker({ id: 'pixel', deskId: 'desk-3', name: 'Pixel', createdAt: 1, task: { name: 'Fix Login', summary: 'Fixing it' }, activity: 'Editing auth.ts', status: 'working' }));
  fake.add(worker({ id: 'nibble', deskId: 'desk-9', name: 'Nibble', createdAt: 2 }));
  fake.add(worker({ id: 'byte', deskId: 'desk-4', name: 'Byte', createdAt: 3, lead: 'pixel' }));
  fake.add(worker({ id: 'dot', deskId: 'desk-10', name: 'Dot', createdAt: 4 }));
  fake.add(worker({ id: 'sh', deskId: 'desk-5', name: 'Shell 🐚', kind: 'shell', createdAt: 5 }));
  fake.tails.set('nibble', 'line 1\nline 2\n$ npm test\nok');
  const settings = { on: true };
  const emitted: ServerMsg[] = [];
  const toasts: string[] = [];
  const visits = new Visits(fake, { on: () => settings.on, emit: (m) => emitted.push(m), toast: (text) => toasts.push(text), now: () => clock });
  t.after(() => visits.stop());
  const r = {
    fake,
    visits,
    settings,
    emitted,
    toasts,
    get now() {
      return clock;
    },
    call(caller: string, body: Record<string, unknown>): Reply {
      const w = fake.get(caller);
      if (!w) throw new Error(`no ${caller}`);
      return visits.handle(w, body) as Reply;
    },
    /** The clock moves on, a tick at a time as the office's timer would. */
    advance(ms: number) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + 250);
        visits.tick(clock);
      }
    },
    set(id: string, status: WorkerStatus) {
      const w = fake.get(id)!;
      w.status = status;
      visits.onWorker({ ...w });
    },
    /** The last full list of visits the floor was sent. */
    lastList(): Visit[] {
      const m = [...emitted].reverse().find((x) => x.t === 'visits');
      return m && m.t === 'visits' ? m.visits : [];
    },
    /** How the caller's visit is going, read from the office's own records: no tool exposes it. */
    status(caller: string, visit: string): Reply {
      const own = visits as unknown as { runs: Map<string, any>; ended: Map<string, any> };
      const run = own.runs.get(visit);
      if (run && run.visit.visitor === caller) {
        return { status: 200, body: { visit, kind: run.visit.kind, phase: run.after === undefined ? run.visit.phase : 'pending', host: run.hostName, done: !!run.result, ...(run.result ?? {}) } };
      }
      const gone = own.ended.get(visit);
      if (gone && gone.run.visit.visitor === caller) {
        return { status: 200, body: { visit, kind: gone.run.visit.kind, phase: 'ended', host: gone.run.hostName, done: true, ...(gone.run.result ?? { ok: false, error: gone.why ?? 'The visit ended' }) } };
      }
      return { status: 404, body: { error: `No visit ${visit} of ${caller}'s` } };
    },
  };
  return r;
}

test('worker arrivals, status changes and departures never prompt independent workers automatically', (t) => {
  const r = rig(t);
  const newcomer = r.fake.add(worker({ id: 'newcomer', deskId: 'desk-11' }));
  r.visits.onWorker(newcomer);
  r.set('nibble', 'working');
  r.set('nibble', 'done');
  r.visits.onWorkerGone(newcomer.id);
  r.advance(60_000);
  assert.deepEqual(r.fake.typed, []);
  assert.deepEqual(r.fake.resumed, []);
  assert.deepEqual(r.emitted, []);
});

test('the roster lists only the independent workers on this floor: no subagents, no shells, none from other floors', (t) => {
  const r = rig(t);
  const res = r.call('pixel', { action: 'roster' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.you, { id: 'pixel', name: 'Pixel', desk: 'Desk 3' });
  assert.deepEqual(
    res.body.roster.map((w: { name: string }) => w.name),
    ['Pixel', 'Nibble', 'Dot'],
  );
  assert.deepEqual(res.body.roster[0], { id: 'pixel', name: 'Pixel', desk: 'Desk 3', status: 'working', busy: true, task: 'Fix Login', activity: 'Editing auth.ts', you: true });
  assert.deepEqual(res.body.roster[1], { id: 'nibble', name: 'Nibble', desk: 'Desk 9', status: 'done', busy: false });
  // A lead with a subagent of its own is still independent, and a subagent whose lead left becomes one.
  assert.equal(independent(r.fake.get('pixel')!), true);
  assert.equal(independent(r.fake.get('byte')!), false);
  assert.equal(independent({ ...r.fake.get('byte')!, lead: undefined }), true);

  // Another floor has its own workers and its own roster: nobody here can reach them, nor they us.
  const other = new Fake();
  other.add(worker({ id: 'zed', deskId: 'desk-1', name: 'Zed' }));
  const upstairs = new Visits(other, { on: () => true, emit: () => undefined });
  const theirs = upstairs.handle(other.get('zed')!, { action: 'roster' }) as Reply;
  assert.deepEqual(
    theirs.body.roster.map((w: { name: string }) => w.name),
    ['Zed'],
  );
  assert.equal((upstairs.handle(other.get('zed')!, { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'hi' }) as Reply).status, 404);
  assert.equal(r.call('pixel', { action: 'visit', kind: 'tell', worker: 'zed', text: 'hi' }).status, 404);
});

test('subagents, other workers’ subagents and a turned-off office get a clear refusal', (t) => {
  const r = rig(t);
  for (const action of ['whoami', 'roster', 'visit', 'look', 'reply']) {
    const res = r.call('byte', { action, kind: 'tell', worker: 'Nibble', text: 'hi', visit: 'v-1' });
    assert.equal(res.status, 403, action);
    assert.match(res.body.error, /You're a subagent of Pixel: subagents don't visit other workers or see the roster/);
  }
  const target = r.call('nibble', { action: 'visit', kind: 'tell', worker: 'Byte', text: 'x' });
  assert.equal(target.status, 403);
  assert.match(target.body.error, /Byte is a subagent: subagents can't be visited/);
  assert.equal(r.call('nibble', { action: 'visit', kind: 'tell', worker: 'byte', text: 'x' }).status, 403, 'by id too');
  assert.match(r.call('nibble', { action: 'visit', kind: 'tell', worker: 'Shell 🐚', text: 'x' }).body.error, /isn't an agent at a desk here/);
  assert.match(r.call('sh', { action: 'roster' }).body.error, /Only agents at a desk/);
  assert.match(r.call('pixel', { action: 'visit', kind: 'tell', worker: 'pixel', text: 'x' }).body.error, /That's you/);
  assert.match(r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nobody', text: 'x' }).body.error, /No one called Nobody/);
  assert.match(r.call('pixel', { action: 'visit', kind: 'tell', text: 'x' }).body.error, /Name the worker/);
  assert.match(r.call('pixel', { action: 'visit', kind: 'dance', worker: 'Nibble' }).body.error, /A visit is one of tell, ask, handoff/);
  assert.match(r.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: '  ' }).body.error, /Give the question in visit_message/);
  assert.match(r.call('pixel', { action: 'look', worker: 'Dot' }).body.error, /Dot has no terminal yet/);
  assert.match(r.call('pixel', { action: 'visit', kind: 'look', worker: 'Nibble' }).body.error, /A visit is one of/, 'a look reads the screen without walking over');
  assert.match(r.call('pixel', { action: 'nope' }).body.error, /Unknown action/);

  r.settings.on = false;
  for (const action of ['whoami', 'roster', 'visit', 'look', 'reply']) {
    const res = r.call('pixel', { action, kind: 'tell', worker: 'Nibble', text: 'hi', visit: 'v-1' });
    assert.equal(res.status, 403, action);
    assert.match(res.body.error, /Visits between workers are turned off in this office \(⚙️ Settings → Subagents & visits → Visits\)/);
  }
  assert.equal(r.emitted.length, 0, 'nothing was shown');
});

test('a look reads the host screen at once, without a walk, a visit or anything typed in', (t) => {
  const r = rig(t);
  const res = r.call('pixel', { action: 'look', worker: 'nibble', lines: 2 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { host: 'Nibble', text: '$ npm test\nok' });
  assert.deepEqual(r.emitted, [], 'no visit is shown');
  assert.equal(r.fake.typed.length, 0, 'nothing is typed into the host');
  assert.deepEqual(r.toasts, []);
});

test('a normal tell to a busy host goes in at once as a steer, with no Escape and no queueing for the turn to end', (t) => {
  const r = rig(t);
  r.set('nibble', 'working');
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'I renamed auth.ts to session.ts' });
  r.advance(0);
  // Typed into the busy host's session the moment the visitor arrived: plain Enter steers
  // droid's running turn, so it reads the message once its current tool call finishes.
  assert.equal(r.fake.typed.length, 1, 'in at once, while it still works');
  assert.deepEqual(r.fake.escapes, [], 'a normal message never cancels a turn');
  const { text } = r.fake.typed[0];
  assert.match(text, /^Factory Flow delivery: message from Pixel \(Desk 3\), a worker, not the owner\n+## Worker message\n```text\nI renamed auth\.ts to session\.ts\n```\n\n## Office guidance\n/);
  assert.match(text, /`visit_message` \(name Pixel, kind "tell"\)/);
  assert.doesNotMatch(text, /urgent/i);
  r.advance(3000);
});

test('a tell that cannot go in while the visitor stands there is left queued, and goes in as soon as the host can take it', (t) => {
  const r = rig(t);
  r.set('nibble', 'needs_input');
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'I renamed auth.ts to session.ts' });
  r.advance(0);
  r.advance(12000);
  assert.equal(r.fake.typed.length, 0, 'not while it waits on the owner');

  r.set('nibble', 'done');
  r.advance(250);
  assert.equal(r.fake.typed.length, 1);
  assert.match(r.fake.typed[0].text, /I renamed auth\.ts to session\.ts/);
});

test('a tell to a host at rest goes straight in, and a sleeping host is woken with it', (t) => {
  const r = rig(t);
  const id = r.call('pixel', { action: 'visit', kind: 'handoff', worker: 'Nibble', text: 'Write tests for session.ts', title: 'Session tests' }).body.visit;
  r.advance(0);
  assert.equal(r.fake.typed.length, 1);
  assert.match(r.fake.typed[0].text, /^Factory Flow delivery: handoff from Pixel \(Desk 3\), a worker, not the owner\n+## Worker message\n```text\nTask: Session tests\nWrite tests for session\.ts\n```\n\n## Office guidance/);
  r.advance(3000);
  assert.equal(r.status('pixel', id).body.delivered, true);

  r.set('dot', 'offline');
  r.advance(0);
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Dot', text: 'wake up' });
  r.advance(0);
  assert.equal(r.fake.resumed.length, 1);
  assert.match(r.fake.resumed[0].text, /wake up/);
});

test('an urgent message to a busy host: one Escape, then the message as a new prompt once the turn stops', (t) => {
  const r = rig(t);
  r.set('nibble', 'working');
  const id = r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'Stop: main is broken', urgent: true }).body.visit;
  r.advance(0);
  assert.deepEqual(r.fake.escapes, ['nibble'], 'one Escape goes in at once');
  assert.equal(r.fake.typed.length, 0, 'not while the turn is still on screen');
  r.advance(1000);
  assert.equal(r.fake.typed.length, 0);
  // Droid prints "Request cancelled by user" and shows its input box; the status follows seconds later.
  r.fake.screens.set('nibble', 'idle');
  r.advance(250);
  assert.equal(r.fake.typed.length, 1);
  assert.deepEqual(
    r.fake.keys.map((k) => [k.id, k.key]),
    [
      ['nibble', 'escape'],
      ['nibble', 'prompt'],
    ],
  );
  assert.ok(r.fake.keys[1].at > r.fake.keys[0].at, 'the prompt goes in after the Escape');
  assert.match(r.fake.typed[0].text, /Delivery: urgent\. The sender requested cancellation of your running turn\./);
  r.advance(3000);
  assert.equal(r.status('pixel', id).body.delivered, true);
  assert.match(r.toasts.join('\n'), /Pixel told Nibble \(urgent\)/);
});

test('an urgent message goes in once the status says the turn ended, or after 5 seconds anyway', (t) => {
  const r = rig(t);
  r.set('nibble', 'working');
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'one', urgent: true });
  r.advance(0);
  assert.deepEqual(r.fake.escapes, ['nibble']);
  r.set('nibble', 'done');
  r.advance(250);
  assert.deepEqual(
    r.fake.typed.map((x) => x.id),
    ['nibble'],
    'the status left working',
  );

  // A turn that won't stop: the message is typed in with Enter (droid steers its turn with it) 5 seconds after the Escape.
  r.set('dot', 'working');
  r.advance(3000 + 0);
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Dot', text: 'two', urgent: true });
  r.advance(0);
  assert.deepEqual(r.fake.escapes, ['nibble', 'dot'], 'one Escape each, never a second');
  const escaped = r.fake.keys.at(-1)!.at;
  r.advance(URGENT_WAIT_MS - 250);
  assert.equal(r.fake.typed.length, 1, 'not before 5 seconds');
  r.advance(250);
  assert.equal(r.fake.typed.length, 2);
  assert.equal(r.fake.keys.at(-1)!.key, 'prompt');
  assert.equal(r.fake.keys.at(-1)!.at - escaped, URGENT_WAIT_MS);
  assert.deepEqual(r.fake.escapes, ['nibble', 'dot']);
});

test('an urgent message to a host at rest goes straight in, with no Escape before it', (t) => {
  const r = rig(t);
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'now', urgent: true });
  r.advance(0);
  assert.equal(r.fake.typed.length, 1);
  assert.deepEqual(r.fake.escapes, []);

  // Its status still says working, but its screen is back at the input box: no Escape either.
  r.set('dot', 'working');
  r.fake.screens.set('dot', 'idle');
  r.advance(3000 + 0);
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Dot', text: 'now', urgent: true });
  r.advance(0);
  assert.equal(r.fake.typed.length, 2);
  assert.deepEqual(r.fake.escapes, []);
});

test('an urgent message waits for a permission prompt, even one the status has not caught', (t) => {
  const r = rig(t);
  r.set('nibble', 'needs_input');
  r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'again', urgent: true });
  r.advance(0 + URGENT_WAIT_MS + 1000);
  assert.equal(r.fake.typed.length, 0);
  assert.deepEqual(r.fake.escapes, []);
  r.set('nibble', 'working');
  r.fake.screens.set('nibble', 'asking');
  r.advance(URGENT_WAIT_MS + 1000);
  assert.equal(r.fake.typed.length, 0, 'Enter would answer the dialog');
  assert.deepEqual(r.fake.escapes, []);
  r.fake.screens.set('nibble', 'busy');
  r.advance(250);
  assert.deepEqual(r.fake.escapes, ['nibble'], 'answered, the turn goes on, and the Escape goes in');
});

test('an ask does not wait for an answer or polling; a later answer is delivered into its session', (t) => {
  const r = rig(t);
  const res = r.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: 'Which port does the dev server use?' });
  const id = res.body.visit;
  r.advance(0);
  const text = r.fake.typed[0].text;
  assert.match(text, /^Factory Flow delivery: question from Pixel \(Desk 3\), a worker, not the owner\n+## Worker message\n```text\nWhich port/);
  assert.ok(text.includes(`visit_reply\` (visit "${id}"`), text);
  assert.match(text, /within about 30 minutes of this delivery/);

  assert.equal(r.call('dot', { action: 'reply', visit: id, text: '5173' }).status, 404, 'only the host answers');
  assert.match(r.call('nibble', { action: 'reply', visit: id, text: '' }).body.error, /Give the answer in visit_reply/);
  r.advance(3000);
  assert.equal(r.status('pixel', id).body.delivered, true);
  r.advance(0 + 10 * 60_000);
  assert.deepEqual(r.lastList(), [], 'the asker has been home for ten minutes, without polling');
  const ok = r.call('nibble', { action: 'reply', visit: id, text: '5173, and the office on 4700' });
  assert.deepEqual(ok, { status: 200, body: { visit: id, to: 'Pixel', delivered: true } });
  assert.equal(r.fake.typed.at(-1)?.id, 'pixel');
  assert.match(r.fake.typed.at(-1)?.text ?? '', /answer from Nibble[\s\S]*## Worker message\n```text\n5173, and the office on 4700\n```\n\n## Office guidance/);
  assert.match(r.call('nibble', { action: 'reply', visit: id, text: 'again' }).body.error, /already answered/);
  assert.deepEqual(r.lastList(), [], 'reply delivery does not invent another walk');
});

test('a queued answer that later fails to go in reopens the question for the host', (t) => {
  const r = rig(t);
  const id = r.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: 'Which port?' }).body.visit;
  r.advance(0 + 3000 + 0 + 250);
  assert.deepEqual(r.lastList(), [], 'the asker is home');
  r.fake.screens.set('pixel', 'asking');
  assert.equal(r.call('nibble', { action: 'reply', visit: id, text: '5173' }).body.queued, true, 'a dialog holds the answer back');
  r.set('pixel', 'exited');
  r.fake.refuseResume = 'its worktree is missing';
  r.fake.screens.set('pixel', 'idle');
  r.advance(250);
  assert.match(r.toasts.at(-1) ?? '', /Couldn't get Nibble's answer to Pixel: its worktree is missing\. The question is open again/);
  r.fake.refuseResume = undefined;
  const again = r.call('nibble', { action: 'reply', visit: id, text: '5173' });
  assert.equal(again.status, 200, 'the host can answer again');
  assert.equal(r.fake.resumed.at(-1)?.id, 'pixel');
  assert.match(r.fake.resumed.at(-1)?.text ?? '', /answer from Nibble/);
});

test('asks expire 30 minutes after delivery, or before delivery if a blocked session never recovers', (t) => {
  const r = rig(t);
  r.set('nibble', 'working');
  const id = r.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: 'Quick one?' }).body.visit;
  r.advance(0 + 250);
  r.advance(ASK_REPLY_MS);
  assert.match(r.call('nibble', { action: 'reply', visit: id, text: 'late' }).body.error, /This ask expired/);
  assert.deepEqual(r.lastList(), []);
  const q = rig(t);
  q.set('nibble', 'needs_input');
  const queued = q.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: 'Still there?' }).body.visit;
  q.advance(ASK_REPLY_MS + 250);
  q.set('nibble', 'done');
  q.advance(250);
  assert.deepEqual(q.fake.typed, [], 'an expired queued question never enters the recovered session');
  assert.match(q.call('nibble', { action: 'reply', visit: queued, text: 'late' }).body.error, /This ask expired/);
  assert.equal(ASK_REPLY_MS, 30 * 60_000);
});

test('a host or visitor leaving mid-visit ends it cleanly', (t) => {
  const r = rig(t);
  r.set('nibble', 'needs_input');
  const ask = r.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: 'Hm?' }).body.visit;
  const tell = r.call('dot', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'fyi' }).body.visit;
  r.advance(0);
  r.fake.ws.delete('nibble');
  r.visits.onWorkerGone('nibble');
  const s = r.status('pixel', ask).body;
  assert.equal(s.ok, false);
  assert.match(s.error, /Nibble left the floor/);
  assert.deepEqual(r.lastList(), []);
  assert.match(r.status('dot', tell).body.error ?? '', /Nibble left the floor/);

  // The visitor leaving takes its visit, and what it left in a queue, with it.
  const q = rig(t);
  q.set('nibble', 'needs_input');
  const v = q.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'later' }).body.visit;
  q.advance(0);
  q.fake.ws.delete('pixel');
  q.visits.onWorkerGone('pixel');
  assert.deepEqual(q.lastList(), []);
  q.set('nibble', 'done');
  q.advance(1000);
  assert.equal(q.fake.typed.length, 0);
  assert.ok(v);

  // A message that can't be typed in says why.
  const f = rig(t);
  f.fake.refuse = 'Worker is not running';
  const bad = f.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'x' }).body.visit;
  f.advance(0 + 3000);
  assert.match(f.status('pixel', bad).body.error, /Couldn't get it to Nibble: Worker is not running/);
});

test('turning visits off ends the ones under way', (t) => {
  const r = rig(t);
  r.set('nibble', 'needs_input');
  const id = r.call('pixel', { action: 'visit', kind: 'ask', worker: 'Nibble', text: 'x' }).body.visit;
  r.advance(0);
  r.settings.on = false;
  r.advance(250);
  r.settings.on = true;
  assert.match(r.status('pixel', id).body.error, /Visits were turned off/);
  r.set('nibble', 'done');
  r.advance(1000);
  assert.equal(r.fake.typed.length, 0, 'disabled queued deliveries never reach the host');
  assert.equal(r.status('pixel', 'v-nope').status, 404);
});

test('how long an asker still waits, in words', () => {
  assert.equal(waitWords(40_000), '40 seconds');
  assert.equal(waitWords(-5), '0 seconds');
  assert.equal(waitWords(240_000), 'about 4 minutes');
});

test('a dialog on screen blocks normal and urgent delivery even while the status still says done', (t) => {
  for (const urgent of [false, true]) {
    const r = rig(t);
    r.fake.screens.set('nibble', 'asking');
    r.call('pixel', { action: 'visit', kind: 'tell', worker: 'Nibble', text: 'wait for the owner', urgent });
    r.advance(0 + 1000);
    assert.equal(r.fake.typed.length, 0);
    assert.deepEqual(r.fake.escapes, []);
    r.fake.screens.set('nibble', 'idle');
    r.advance(250);
    assert.equal(r.fake.typed.length, 1);
  }
});

test('team messages carry on as before beside visits: a lead reaches its subagent with no walk and no visit', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'factory-flow-visits-team-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = rig(t);
  const sent: [string, string][] = [];
  const teamWorkers: TeamWorkers = {
    list: () => r.fake.list(),
    get: (id) => r.fake.get(id),
    deskOccupied: (id) => r.fake.list().some((w) => w.deskId === id),
    officeDefault: undefined as AgentChoice | undefined,
    hire: () => 'no',
    prompt: (id, text) => {
      sent.push([id, text]);
      return undefined;
    },
    resume: () => undefined,
    kill: async () => ({}),
    tail: (id) => r.fake.tail(id, 10),
    setTask: () => undefined,
  };
  const team = new Team(teamWorkers, { dataDir: dir, dir: '/proj', git: true, settings: () => SUBAGENT_DEFAULTS, toast: () => undefined });
  t.after(() => team.stop());
  const res = await team.handle(r.fake.get('pixel')!, { action: 'send', worker: 'Byte', text: 'Use v2' });
  assert.equal(res.status, 200);
  assert.equal(sent[0][0], 'byte');
  assert.match(sent[0][1], /^Factory Flow delivery: message from your lead Pixel \(a worker, not the owner\)/);
  assert.match(sent[0][1], /## Worker message\n```text\nUse v2\n```\n\n## Office guidance/);
  r.advance(5000);
  assert.deepEqual(r.emitted, [], 'nobody walked anywhere');
  // The visits setting changes nothing about hiring.
  assert.equal(team.cannotHire(r.fake.get('nibble')!), undefined);
});

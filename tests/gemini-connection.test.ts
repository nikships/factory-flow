import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GeminiConnection } from '../src/server/gemini-connection.js';
import { GeminiDecisionsStore } from '../src/server/gemini-decisions.js';
import type { GeminiConnectionState } from '../src/shared/gemini-vibes.js';
import type { ServerMsg } from '../src/shared/protocol.js';

const key = `AIza${'test'.repeat(8)}`;
type Reply = Extract<ServerMsg, { t: 'gemini.setup' }>;
const ready = () => new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 0.96, confidence: 0.92 } }, usage_metadata: { prompt_token_count: 148 } }));

function rig(t: { after(fn: () => unknown): unknown }, fetchImpl: typeof fetch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gemini-connection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new GeminiDecisionsStore(dir);
  const states: GeminiConnectionState[] = [];
  let airgapped = false;
  const connection = new GeminiConnection({ store, fetchImpl, airgapped: () => airgapped, broadcastGemini: (state) => states.push(state), now: () => 1234 });
  t.after(() => connection.stop());
  return {
    connection,
    store,
    states,
    airgap: () => {
      airgapped = true;
      connection.stop();
    },
  };
}

test('connection verifies and persists a key, rechecks rejection, toggles wake filtering and disconnects', async (t) => {
  let reject = false;
  let calls = 0;
  const r = rig(t, async () => {
    calls++;
    return reject ? new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }), { status: 400 }) : ready();
  });
  const replies: Reply[] = [];
  await r.connection.check((m) => replies.push(m));
  assert.equal(replies.at(-1)?.ok, false);
  assert.equal(calls, 0);
  await r.connection.connect(key, 'Owner', (m) => replies.push(m));
  assert.equal(replies.at(-1)?.ok, true);
  assert.equal(r.store.apiKey(), key);
  assert.equal(r.states[0].checking, true);
  assert.equal(r.states.at(-1)?.checking, false);
  assert.equal(JSON.stringify(r.states).includes(key), false);
  assert.equal(r.connection.geminiState().inputTokens, 148);
  assert.equal(r.connection.setWakeFilterOn(false), undefined);
  assert.equal(r.store.wakeFilterOn(), false);
  reject = true;
  await r.connection.check((m) => replies.push(m));
  assert.equal(replies.at(-1)?.ok, false);
  assert.match(r.store.rejected()!, /API key not valid/);
  assert.equal(r.connection.geminiState().calls, 1);
  reject = false;
  await r.connection.check((m) => replies.push(m));
  assert.equal(r.store.rejected(), undefined);
  assert.equal(r.store.checkedAt(), 1234);
  assert.equal(r.connection.geminiState().calls, 2);
  assert.equal(r.connection.disconnect(), undefined);
  assert.equal(r.store.connected(), false);
  assert.equal(r.states.at(-1)?.connected, false);
});

test('invalid keys and airgapped requests never make a verification call', async (t) => {
  const r = rig(t, async () => assert.fail('unexpected fetch'));
  const replies: Reply[] = [];
  for (const input of ['', 'short', 'contains whitespace in a key']) await r.connection.connect(input, 'Owner', (m) => replies.push(m));
  assert.equal(
    replies.every((m) => !m.ok),
    true,
  );
  r.airgap();
  await r.connection.connect(key, 'Owner', (m) => replies.push(m));
  await r.connection.check((m) => replies.push(m));
  assert.match(replies.at(-1)?.error ?? '', /airgapped/i);
});

test('disconnect, replacement and airgapped mode cancel pending probes without saving an old key', async (t) => {
  const pending: ((r: Response) => void)[] = [];
  const signals: AbortSignal[] = [];
  const r = rig(t, async (_url, init) => {
    signals.push(init!.signal!);
    return new Promise<Response>((resolve) => pending.push(resolve));
  });
  const replies: Reply[] = [];
  const first = r.connection.connect(key, 'Owner', (m) => replies.push(m));
  const secondKey = `${key}next`;
  const second = r.connection.connect(secondKey, 'Owner', (m) => replies.push(m));
  assert.equal(signals[0].aborted, true);
  pending[1](ready());
  await second;
  pending[0](ready());
  await first;
  assert.equal(r.store.apiKey(), secondKey);
  assert.equal(replies.filter((m) => m.ok).length, 1);
  const check = r.connection.check((m) => replies.push(m));
  r.connection.disconnect();
  assert.equal(signals[2].aborted, true);
  pending[2](ready());
  await check;
  assert.equal(r.store.connected(), false);
  const last = r.connection.connect(key, 'Owner', (m) => replies.push(m));
  r.airgap();
  assert.equal(signals[3].aborted, true);
  pending[3](ready());
  await last;
  assert.equal(r.store.connected(), false);
  assert.equal(r.connection.geminiState().checking, false);
});

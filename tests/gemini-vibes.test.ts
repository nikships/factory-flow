import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callGeminiDecisions, GeminiDecisionsStore, probeGeminiKey, redactGeminiSecrets } from '../src/server/gemini-decisions.js';
const TEST_KEY = 'AIzaSyTestKeyForDecisions1234567890123456789';

test('GeminiDecisionsStore persists mode 0600 on disk and never leaks raw key in fingerprint', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gemini-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const store = new GeminiDecisionsStore(dir);
  assert.equal(store.connected(), false);
  assert.equal(store.wakeFilterOn(), true);
  assert.equal(store.saveKey('bad', 'Dev', 1000), 'Enter a valid Gemini API key.');

  const staleTemp = path.join(dir, 'gemini.json.tmp');
  writeFileSync(staleTemp, 'stale temporary file');
  chmodSync(staleTemp, 0o666);
  assert.equal(store.saveKey(`  ${TEST_KEY}  `, 'Dev', 1234), undefined);
  assert.equal(store.connected(), true);
  assert.equal(store.apiKey(), TEST_KEY);
  assert.equal(store.fingerprint(), 'AIza…6789');
  assert.equal(store.at(), 1234);

  const file = path.join(dir, 'gemini.json');
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
  const rawDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(rawDisk.apiKey, TEST_KEY);

  assert.equal(store.setWakeFilterOn(false), undefined);
  store.markChecked(2000, 'API key expired');

  const reloaded = new GeminiDecisionsStore(dir);
  assert.equal(reloaded.connected(), true);
  assert.equal(reloaded.wakeFilterOn(), false);
  assert.equal(reloaded.checkedAt(), 2000);
  assert.equal(reloaded.rejected(), 'API key expired');

  assert.equal(reloaded.disconnect(), undefined);
  assert.equal(reloaded.connected(), false);
  assert.equal(reloaded.apiKey(), undefined);
});

test('redactGeminiSecrets scrubs raw, URL-encoded, bearer and provider tokens', () => {
  const secret = '*****************************';
  const input = [
    `Key=${TEST_KEY}`,
    `Encoded=${encodeURIComponent(secret)}`,
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'x-goog-api-key: customKeyValue123',
    'Factory fk-1234567890abcdefghijklmno and GitHub ghp_1234567890abcdefghijklmnop',
  ].join('\n');
  const scrubbed = redactGeminiSecrets(input, [secret]);
  assert.doesNotMatch(scrubbed, new RegExp(TEST_KEY));
  assert.doesNotMatch(scrubbed, /my-custom-secret-value/);
  assert.doesNotMatch(scrubbed, /eyJhbGciOi/);
  assert.doesNotMatch(scrubbed, /customKeyValue123/);
  assert.doesNotMatch(scrubbed, /fk-1234567890/);
  assert.doesNotMatch(scrubbed, /ghp_1234567890/);

  // Keys ending with '-' or '_' (non-word boundary) are also scrubbed cleanly
  const dashEnd = redactGeminiSecrets('Token AIzaSyD0123456789abcdefghijk- and fk-********************* here');
  assert.doesNotMatch(dashEnd, /AIzaSyD/);
  assert.doesNotMatch(dashEnd, /fk-1234567890/);
});

test('callGeminiDecisions and probeGeminiKey parse real /v1beta/decisions shapes, blocks and errors', async () => {
  let seenHeaders: HeadersInit | undefined;
  let seenBody = '';
  const okFetch: typeof fetch = async (_url, init) => {
    seenHeaders = init?.headers;
    seenBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        answers: {
          ready: { type: 'noul', noul: 0.96, confidence: 0.92 },
          mood: {
            type: 'choice',
            choice: 'deep_crunch',
            probabilities: { calm_planning: 0.04, celebration_swell: 0.02, debugging_tension: 0.05, deep_crunch: 0.89 },
            confidence: 0.89,
          },
          rubric: {
            type: 'score',
            score: 2,
            legend: { '0': 'low', '1': 'mid', '2': 'high' },
            probabilities: { '0': 0.02, '1': 0.08, '2': 0.9 },
            confidence: 0.9,
          },
        },
        usage: {
          total_tokens: 148,
          total_input_tokens: 148,
          input_tokens_by_modality: [{ modality: 'text', tokens: 148 }],
          total_output_tokens: 0,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  let clock = 5000;
  const res = await callGeminiDecisions({
    apiKey: TEST_KEY,
    input: 'Floor check',
    questions: {
      ready: { type: 'noul', instructions: 'Is Byte working?' },
      mood: { type: 'choice', instructions: 'What is the floor mood?', criteria: { calm_planning: 'calm', deep_crunch: 'crunch' } },
      rubric: { type: 'score', instructions: 'Score urgency', criteria: ['low', 'mid', 'high'] },
    },
    fetchImpl: okFetch,
    now: () => (clock += 42),
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.inputTokens, 148);
    assert.equal(res.latencyMs, 42);
    assert.equal(res.answers.ready?.type, 'noul');
    assert.equal(res.answers.mood?.type, 'choice');
    assert.equal(res.answers.rubric?.type, 'score');
  }
  assert.equal((seenHeaders as Record<string, string>)['x-goog-api-key'], TEST_KEY);
  assert.match(seenBody, /"model":"gemini-decision-1"/);

  // Validation guards
  const emptyQ = await callGeminiDecisions({ apiKey: TEST_KEY, input: 'x', questions: {}, fetchImpl: okFetch });
  assert.equal(emptyQ.ok, false);
  const badKeyQ = await callGeminiDecisions({
    apiKey: TEST_KEY,
    input: 'x',
    questions: { 'bad key!': { type: 'noul', instructions: 'x' } },
    fetchImpl: okFetch,
  });
  assert.equal(badKeyQ.ok, false);

  // Key rejection + secret scrubbing in error message
  const rejectFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: `API key not valid: ${TEST_KEY}. Please pass a valid API key.`,
          status: 'INVALID_ARGUMENT',
        },
      }),
      { status: 400 },
    );
  const probeFail = await probeGeminiKey(TEST_KEY, { fetchImpl: rejectFetch });
  assert.equal(probeFail.ok, false);
  if (!probeFail.ok) {
    assert.equal(probeFail.keyRejected, true);
    assert.doesNotMatch(probeFail.error, new RegExp(TEST_KEY));
  }

  // Safety block handling
  const blockedFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        answers: {},
        prompt_feedback: { block_reason: 'SAFETY' },
        usage_metadata: { prompt_token_count: 32 },
      }),
      { status: 200 },
    );
  const probeBlocked = await probeGeminiKey(TEST_KEY, { fetchImpl: blockedFetch });
  assert.equal(probeBlocked.ok, false);
  if (!probeBlocked.ok) assert.match(probeBlocked.error, /SAFETY/);
});

test('already cancelled Decisions requests never start a fetch', async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  const result = await callGeminiDecisions({
    apiKey: TEST_KEY,
    input: 'cancelled',
    questions: { ready: { type: 'noul', instructions: 'Ready?' } },
    signal: abort.signal,
    fetchImpl: async () => {
      calls++;
      return new Response('{}');
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
});

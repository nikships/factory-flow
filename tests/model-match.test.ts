import test from 'node:test';
import assert from 'node:assert/strict';
import { matchModel } from '../src/server/model-match.js';
import type { DroidModelOption } from '../src/server/droid-models.js';

// Trimmed from this Mac's real `droid.list_models` catalogue, in Droid's order: BYOK models first, then Factory's.
const CATALOGUE: DroidModelOption[] = [
  { id: 'custom:droidproxy:gpt-6-astra', displayName: 'DroidProxy: GPT 6 Astra', custom: true },
  { id: 'custom:droidproxy:gpt-6.1-sol', displayName: 'DroidProxy: GPT 6.1 Sol', custom: true },
  { id: 'custom:droidproxy:gpt-6.1-terra', displayName: 'DroidProxy: GPT 6.1 Terra', custom: true },
  { id: 'custom:droidproxy:gpt-6-luna', displayName: 'DroidProxy: GPT 6 Luna', custom: true },
  { id: 'custom:droidproxy:fable-5', displayName: 'custom:droidproxy:fable-5', custom: true },
  { id: 'claude-fable-5.2', displayName: 'Fable 5.2', provider: 'anthropic' },
  { id: 'claude-opus-5-5', displayName: 'Opus 5.5', provider: 'anthropic' },
  { id: 'claude-opus-5-5-fast', displayName: 'Opus 5.5 Fast Mode', provider: 'anthropic' },
  { id: 'claude-opus-5', displayName: 'Opus 5', provider: 'anthropic' },
  { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', provider: 'anthropic' },
  { id: 'gpt-6-astra', displayName: 'GPT-6 Astra', provider: 'openai' },
  { id: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', provider: 'openai' },
  { id: 'gpt-6-sol', displayName: 'GPT-6 Sol', provider: 'openai' },
  { id: 'gpt-6-sol-fast', displayName: 'GPT-6 Sol Fast Mode', provider: 'openai' },
  { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', provider: 'openai' },
  { id: 'gpt-6-luna', displayName: 'GPT-6 Luna', provider: 'openai' },
  { id: 'gpt-6.1-terra', displayName: 'GPT-6.1 Terra', provider: 'openai' },
  { id: 'glm-5.3-flash', displayName: 'GLM-5.3-Flash', provider: 'factory' },
  { id: 'glm-5.3', displayName: 'GLM-5.3', provider: 'factory' },
];

const picked = (query: string) => {
  const hit = matchModel(query, CATALOGUE);
  return 'error' in hit ? hit.error : hit.model.id;
};

test('the words typed after /model pick the model the owner would get in Droid’s filter', () => {
  assert.equal(picked('Sol'), 'gpt-6.1-sol', 'GPT Sol on Factory credits');
  assert.equal(picked('droidproxy sol'), 'custom:droidproxy:gpt-6.1-sol', 'DroidProxy’s Sol');
  assert.equal(picked('DroidProxy Sol'), 'custom:droidproxy:gpt-6.1-sol');
  assert.equal(picked('terra'), 'gpt-6.1-terra');
  assert.equal(picked('droidproxy terra'), 'custom:droidproxy:gpt-6.1-terra');
  assert.equal(picked('droidproxy luna'), 'custom:droidproxy:gpt-6-luna');
  assert.equal(picked('opus'), 'claude-opus-5-5', 'the shortest name first, so not Opus 5.5 Fast Mode');
  assert.equal(picked('opus 5'), 'claude-opus-5', 'a whole word beats a prefix of 5.5');
  assert.equal(picked('opus fast'), 'claude-opus-5-5-fast');
  assert.equal(picked('son'), 'claude-sonnet-5-5', 'a prefix is enough');
  assert.equal(picked('claude opus'), 'claude-opus-5-5', 'words from the id count');
  assert.equal(picked('glm flash'), 'glm-5.3-flash');
  assert.equal(picked('sol fast'), 'gpt-6-sol-fast');
});

test('an exact id or display name wins, and other matches come back for the lead to choose from', () => {
  assert.equal(picked('gpt-6-sol'), 'gpt-6-sol');
  assert.equal(picked('GPT-6 Sol'), 'gpt-6-sol');
  assert.equal(picked('custom:droidproxy:fable-5'), 'custom:droidproxy:fable-5');
  const hit = matchModel('sol', CATALOGUE);
  assert.ok(!('error' in hit));
  assert.deepEqual(
    hit.others.map((m) => m.id),
    ['gpt-6-sol', 'gpt-5.6-sol', 'gpt-6-sol-fast', 'custom:droidproxy:gpt-6.1-sol'],
    'newest first in Droid’s order, then longer names, then BYOK',
  );
  const exact = matchModel('GPT-6.1 Sol', CATALOGUE);
  assert.ok(!('error' in exact));
  assert.deepEqual(exact.others, []);
  const shared = matchModel('GPT-6.1 Sol', [{ id: 'custom:gpt-6.1-sol', displayName: 'GPT-6.1 Sol', custom: true }, ...CATALOGUE]);
  assert.ok(!('error' in shared));
  assert.equal(shared.model.id, 'gpt-6.1-sol', 'a BYOK entry reusing a Factory name loses to Factory');
  assert.deepEqual(
    shared.others.map((m) => m.id),
    ['custom:gpt-6.1-sol'],
  );
});

test('a BYOK model without a gateway in its id still ranks after Factory models', () => {
  const models: DroidModelOption[] = [
    { id: 'custom:gemini-4-carbon-interactions', displayName: 'Gemini 4 Carbon Interactions', custom: true },
    { id: 'gemini-4-carbon', displayName: 'Gemini 4 Carbon', provider: 'google' },
  ];
  const hit = matchModel('carbon', models);
  assert.ok(!('error' in hit));
  assert.equal(hit.model.id, 'gemini-4-carbon');
});

test('nothing matching, or nothing typed, says what to pass instead', () => {
  assert.match(picked('dp sol'), /No model Droid offers here matches "dp sol".*team_models/);
  assert.match(picked('  '), /after \/model/);
  assert.match(picked(':::'), /No model Droid offers here matches ":::"/, 'punctuation alone matches nothing rather than everything');
  assert.ok('error' in matchModel('sol', []));
});

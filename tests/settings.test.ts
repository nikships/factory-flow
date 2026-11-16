import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings } from '../src/client/state.js';
import { rememberedChoice } from '../src/client/ui/models.js';

const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

test('desk model memory defaults on and can be disabled without losing saved choices', () => {
  mem.clear();
  mem.set('factory-flow.droid-model.desk:desk-1', 'model-a');
  mem.set('factory-flow.droid-effort.desk:desk-1', 'high');
  mem.set('factory-flow.droid-model.ask-models', 'model-b');
  assert.equal(loadSettings().rememberDeskModels, true);
  assert.deepEqual(rememberedChoice('desk:desk-1'), { model: 'model-a', effort: 'high' });
  mem.set('factory-flow.settings', JSON.stringify({ rememberDeskModels: false }));
  assert.deepEqual(rememberedChoice('desk:desk-1'), {});
  assert.deepEqual(rememberedChoice('ask-models'), { model: 'model-b' });
  mem.set('factory-flow.settings', JSON.stringify({ rememberDeskModels: true }));
  assert.deepEqual(rememberedChoice('desk:desk-1'), { model: 'model-a', effort: 'high' });
});

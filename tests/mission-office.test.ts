import test from 'node:test';
import assert from 'node:assert/strict';
import { ORCHESTRATOR_ID, type MissionAgent, type MissionControlState } from '../src/shared/mission-control.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { orchestratorPhase, orchestratorAwake, missionTeamLine, lastUsedWords } from '../src/client/mission-status.js';
const worker = (over: Partial<WorkerInfo>): WorkerInfo =>
  ({ id: ORCHESTRATOR_ID, kind: 'agent', name: 'Orchestrator', color: '#ee6018', deskId: '', status: 'idle', acked: true, createdBy: '', createdAt: 0, cols: 120, rows: 40, open: true, ...over }) as WorkerInfo;
// As the server sends it: `team` is the session's team while there is one.
const state = (over: Partial<MissionControlState['orchestrator']> = {}, bots: MissionAgent[] = []): MissionControlState => ({ orchestrator: { settings: { on: true }, team: over.agent?.team ?? [], ...over }, bots });

test('its phase: off, blocked, fresh, or its session’s status', () => {
  assert.equal(orchestratorPhase(undefined), 'off');
  assert.equal(orchestratorPhase(state({ settings: { on: false } })), 'off');
  assert.equal(orchestratorPhase(state()), 'fresh');
  assert.equal(orchestratorPhase(state({ blocked: 'Droid is signed out' })), 'blocked');
  assert.equal(orchestratorPhase(state({ blocked: 'x', agent: { worker: worker({ status: 'working' }), team: [] } })), 'working', 'a running turn carries on');
  assert.equal(orchestratorPhase(state({ blocked: 'x', agent: { worker: worker({ status: 'exited' }), team: [] } })), 'blocked');
  assert.equal(orchestratorPhase(state({ agent: { worker: worker({ status: 'needs_input' }), team: [] } })), 'needs_input');
});

test('its terminal opens only while it has a session that is awake; otherwise its prompt box stands in', () => {
  const at = (status: WorkerInfo['status']) => state({ agent: { worker: worker({ status }), team: [] } });
  assert.equal(orchestratorAwake(undefined), undefined);
  assert.equal(orchestratorAwake(state()), undefined, 'never prompted');
  assert.equal(orchestratorAwake(state({ settings: { on: false }, agent: { worker: worker({ status: 'working' }), team: [] } })), undefined, 'off');
  for (const status of ['exited', 'offline'] as const) assert.equal(orchestratorAwake(at(status)), undefined, status);
  for (const status of ['starting', 'idle', 'working', 'needs_input', 'done'] as const) assert.equal(orchestratorAwake(at(status))?.id, ORCHESTRATOR_ID, status);
});

test('the words: a team across floors, and when a bot was last used', () => {
  assert.equal(missionTeamLine([]), undefined);
  assert.equal(
    missionTeamLine([
      { id: 'a', name: 'A', floor: 'f1', floorName: 'one', status: 'working' },
      { id: 'b', name: 'B', floor: 'f2', floorName: 'two', status: 'needs_input' },
    ]),
    '🧭 2 subagents on 2 floors · 1 working · 1 needs you',
  );
  assert.equal(missionTeamLine([{ id: 'a', name: 'A', floor: 'f1', floorName: 'one', status: 'idle' }]), '🧭 1 subagent');
  const now = 10_000_000_000;
  assert.equal(lastUsedWords(undefined, now), 'never');
  assert.equal(lastUsedWords(now - 5_000, now), 'just now');
  assert.equal(lastUsedWords(now - 12 * 60_000, now), '12 min ago');
  assert.equal(lastUsedWords(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(lastUsedWords(now - 86_400_000, now), '1 day ago');
});

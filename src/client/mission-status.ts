import type { MissionControlState, MissionTeamMember } from '../shared/mission-control';
import type { WorkerInfo, WorkerStatus } from '../shared/protocol';
import { isAsleep } from '../shared/status';
import { teamCounts } from '../shared/team';

export type OrchestratorPhase = 'off' | 'blocked' | 'fresh' | WorkerStatus;

export function orchestratorPhase(state: MissionControlState | null | undefined): OrchestratorPhase {
  const o = state?.orchestrator;
  if (!o?.settings.on) return 'off';
  const w = o.agent?.worker;
  if (o.blocked && (!w || isAsleep(w.status))) return 'blocked';
  return w ? w.status : 'fresh';
}

/** One word or two for each phase, as the status pills say them. */
export const PHASE_WORD: Record<OrchestratorPhase, string> = {
  off: 'off',
  blocked: "can't start",
  fresh: 'ready',
  starting: 'starting',
  idle: 'ready',
  working: 'working',
  needs_input: 'needs you',
  done: 'done',
  exited: 'asleep',
  offline: 'asleep',
};

/** The Orchestrator's session while its terminal can open: started and awake. Otherwise its prompt box stands in, and a prompt wakes it. */
export function orchestratorAwake(state: MissionControlState | null | undefined): WorkerInfo | undefined {
  const w = state?.orchestrator.settings.on ? state.orchestrator.agent?.worker : undefined;
  return w && !isAsleep(w.status) ? w : undefined;
}

/** "🧭 3 subagents on 2 floors · 2 working · 1 needs you", or undefined for an agent with no team. */
export function missionTeamLine(team: readonly MissionTeamMember[]): string | undefined {
  if (!team.length) return undefined;
  const floors = new Set(team.map((m) => m.floor)).size;
  const { working, attention } = teamCounts(team.map((m) => ({ status: m.status, acked: true, lead: 'x' })));
  return [`🧭 ${team.length} subagent${team.length === 1 ? '' : 's'}${floors > 1 ? ` on ${floors} floors` : ''}`, working && `${working} working`, attention && `${attention} need${attention === 1 ? 's' : ''} you`]
    .filter(Boolean)
    .join(' · ');
}

/** When a bot's key was last used: "just now", "12 min ago", "3 h ago", "2 days ago", or "never". */
export function lastUsedWords(at: number | undefined, now: number): string {
  if (!at) return 'never';
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

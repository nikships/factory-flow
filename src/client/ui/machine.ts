import type { MachineState } from '../../shared/protocol';

// Machine status shared by the companion windows.

/** Green while there's room, amber when it's getting full, red from where hiring gets a warning. */
export function loadColor(pct: number): string {
  return pct >= 90 ? '#ef4444' : pct >= 70 ? '#f2b84b' : '#3ccf91';
}

export function fmtGb(bytes: number): string {
  const gb = bytes / 2 ** 30;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

/** The office has as many workers as it takes. */
export function officeFull(s: MachineState): boolean {
  return s.limit !== undefined && s.workers >= s.limit;
}

/** What the hire dialog says while the machine is under pressure. */
export function pressureNote(s: MachineState): string | undefined {
  return s.pressure ? `⚠️ This machine is under pressure: ${s.pressure}. Another worker may slow down the ones already working.` : undefined;
}

import type { ComputerPhase } from '../../shared/factory-computers';
export const PHASE_WORD: Record<ComputerPhase, string> = { active: 'Active', asleep: 'Asleep', provisioning: 'Provisioning', waking: 'Waking', error: 'Error' };

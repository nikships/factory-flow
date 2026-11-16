/** A worker waiting on the owner, as `GET /api/status` names it (src/server/office-status.ts). */
export interface StatusWaiting {
  id: string;
  name: string;
  status: 'needs_input' | 'done';
  /** Empty for a building agent (the Orchestrator), which sits in Mission Control on every floor. */
  floor: string;
  floorName: string;
  task?: string;
  since: number;
}

/** What the office's `GET /api/status` answers (src/server/office-status.ts). */
export interface OfficeStatus {
  workers: number;
  working: number;
  needsInput: number;
  done: number;
  phones: number;
  browsers: number;
  floors: number;
  waiting: StatusWaiting[];
}

export type TrayOfficeState = 'starting' | 'running' | 'stopped';

export interface TrayView {
  state: TrayOfficeState;
  /** Unset when the office didn't answer, or is older than the status route. */
  status?: OfficeStatus;
  /** The app's own window (companion page), included in the server's browser count. */
  ownWindows: number;
  /** The app is showing an office it didn't start (a terminal's `npm start`), which quitting leaves running. */
  external: boolean;
  /** The app's version, for Check for Updates. */
  version: string;
}

export type TrayAction = 'open' | 'restart' | 'updates' | 'quit' | 'quitStoppingWorkers';

/** Which worker a click opens: the office goes to its floor and opens its terminal (see src/client/worker-link.ts). */
export interface WorkerLink {
  worker: string;
  /** Empty for a building agent, which every floor opens. */
  floor: string;
  /** Open the worker in Thread rather than its terminal. */
  view?: 'thread';
}

export type TrayItem = { type: 'separator' } | { label: string; enabled: boolean; sublabel?: string; action?: TrayAction; checked?: boolean };
const NAME_MAX = 60;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const plain = (v: unknown, max: number) => (typeof v === 'string' ? clip(v.replace(/\s+/g, ' ').trim(), max) : '');
const natural = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function parseWaiting(raw: unknown): StatusWaiting | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const id = plain(r.id, 200);
  const floor = plain(r.floor, 200);
  if (!id || (r.status !== 'needs_input' && r.status !== 'done') || !natural(r.since)) return undefined;
  const task = plain(r.task, NAME_MAX);
  return { id, name: plain(r.name, NAME_MAX) || 'A worker', status: r.status, floor, floorName: plain(r.floorName, NAME_MAX), ...(task ? { task } : {}), since: r.since };
}

/**
 * Reads what the office sent. The counts every office has sent since the menu bar icon came are required;
 * `done`, `floors` and `waiting` came later, so an older office that is already running still shows its counts.
 */
export function parseStatus(raw: unknown): OfficeStatus | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const keys = ['workers', 'working', 'needsInput', 'phones', 'browsers'] as const;
  if (!keys.every((k) => natural(r[k]))) return undefined;
  const waiting = Array.isArray(r.waiting) ? r.waiting.slice(0, 50).flatMap((w) => parseWaiting(w) ?? []) : [];
  return {
    workers: r.workers as number,
    working: r.working as number,
    needsInput: r.needsInput as number,
    done: natural(r.done) ? r.done : 0,
    phones: r.phones as number,
    browsers: r.browsers as number,
    floors: natural(r.floors) ? r.floors : 1,
    waiting,
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many workers wait on the owner: the number beside the menu bar icon and on the Dock icon. */
function waitingCount(v: Pick<TrayView, 'state' | 'status'>): number {
  return v.state === 'running' && v.status ? v.status.needsInput + v.status.done : 0;
}

/** The menu's first lines, which say what the office is doing. */
export function statusLines(v: TrayView): string[] {
  if (v.state === 'starting') return ['The office is starting…'];
  if (v.state === 'stopped') return ['The office is stopped'];
  const lines: string[] = [];
  const s = v.status;
  if (!s) lines.push('The office is running');
  else {
    const busy = [...(s.working ? [`${s.working} working`] : []), ...(s.needsInput ? [`${count(s.needsInput, 'needs', 'need')} input`] : []), ...(s.done ? [`${s.done} done`] : [])];
    lines.push(!s.workers ? 'No workers' : busy.length ? [count(s.workers, 'worker'), ...busy].join(' · ') : `${count(s.workers, 'worker')}, none busy`);
    const browsers = Math.max(0, s.browsers - v.ownWindows);
    const devices = [...(s.phones ? [count(s.phones, 'phone')] : []), ...(browsers ? [count(browsers, 'browser')] : [])];
    lines.push(devices.length ? `${devices.join(' · ')} connected` : 'No phones or browsers connected');
  }
  if (v.external) lines.push('Started outside the app');
  return lines;
}

export function trayTooltip(v: TrayView): string {
  return ['Factory Flow', ...statusLines(v)].join('\n');
}

/** The text beside the menu bar icon: how many workers wait on the owner, or nothing. */
export function trayTitle(v: TrayView): string {
  const n = waitingCount(v);
  return n ? String(n) : '';
}

export function trayMenu(v: TrayView): TrayItem[] {
  const running = v.state === 'running';
  return [
    ...statusLines(v).map((label): TrayItem => ({ label, enabled: false })),
    { type: 'separator' },
    { label: 'Open Office Companion', enabled: v.state !== 'starting', action: 'open' },
    { type: 'separator' },
    { label: v.state === 'stopped' ? 'Start Office' : 'Restart Office', enabled: v.state !== 'starting' && !v.external, action: 'restart' },
    { type: 'separator' },
    { label: 'Check for Updates…', enabled: true, sublabel: `Version ${v.version}`, action: 'updates' },
    { type: 'separator' },
    { label: 'Quit Factory Flow', enabled: true, action: 'quit' },
    { label: 'Quit and Stop Workers…', enabled: running && !v.external, action: 'quitStoppingWorkers' },
  ];
}

/** `#worker=<id>&floor=<id>[&view=thread]`: what the office page reads to open a worker's terminal (src/client/worker-link.ts). */
export function workerHash(link: WorkerLink): string {
  return `#${new URLSearchParams({ worker: link.worker, ...(link.floor ? { floor: link.floor } : {}), ...(link.view ? { view: link.view } : {}) }).toString()}`;
}

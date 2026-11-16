import type { ThreadEntry } from '../../shared/worker-thread';

/**
 * The parts of a `thread.live` message (see the live layer in `src/shared/thread-live.ts`) the Thread's
 * shell reads, checked field by field because an older or newer office may send more or less.
 */
export interface LiveTool {
  id?: string;
  name: string;
  startedAt: number;
  phase: 'running' | 'waiting_permission';
  output?: string;
  more?: number;
}

export interface LiveSettings {
  model?: string;
  modelName?: string;
  reasoningEffort?: string;
  interactionMode?: string;
}

export interface LiveView {
  rev: number;
  /** Server clock when computed, for timers: `skew` is this client's clock minus it. */
  at: number;
  skew: number;
  status: string;
  working: string;
  label?: string;
  turnStartedAt?: number;
  phaseSince?: number;
  after?: string;
  stream?: { kind: 'thinking' | 'text'; text: string; since: number };
  tools: LiveTool[];
  waiting?: { kind: string; toolId?: string };
  settings?: LiveSettings;
  /** Droid's side chat (/btw) as the terminal shows it, while it is open. */
  side?: { text: string };
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function settingsOf(raw: unknown): LiveSettings | undefined {
  const s = obj(raw);
  if (!s) return undefined;
  return {
    model: str(s.model),
    modelName: str(s.modelName),
    reasoningEffort: str(s.reasoningEffort),
    interactionMode: str(s.interactionMode),
  };
}

/**
 * The live view in [msg] for [workerId] and [sessionId], or undefined when it is not one, is for another
 * worker or session, or is not newer than [previous] (each message replaces the last one wholesale).
 */
export function liveFrom(msg: unknown, workerId: string, sessionId: string | undefined, previous: LiveView | undefined, now = Date.now()): LiveView | undefined {
  const m = obj(msg);
  if (m?.t !== 'thread.live' || m.workerId !== workerId) return undefined;
  if (m.sessionId !== sessionId) return undefined;
  const live = obj(m.live);
  const rev = num(live?.rev);
  const at = num(live?.at);
  const status = str(live?.status);
  if (!live || rev === undefined || at === undefined || !status) return undefined;
  if (previous && rev <= previous.rev) return undefined;
  const stream = obj(live.stream);
  const streamKind = stream?.kind === 'thinking' || stream?.kind === 'text' ? stream.kind : undefined;
  const streamText = str(stream?.text);
  const waiting = obj(live.waiting);
  const sideText = str(obj(live.side)?.text);
  const tools = Array.isArray(live.tools)
    ? live.tools.flatMap((raw): LiveTool[] => {
        const t = obj(raw);
        const name = str(t?.name);
        const startedAt = num(t?.startedAt);
        if (!t || !name || startedAt === undefined) return [];
        return [{ id: str(t.id), name, startedAt, phase: t.phase === 'waiting_permission' ? 'waiting_permission' : 'running', output: str(t.output), more: num(t.more) }];
      })
    : [];
  return {
    rev,
    at,
    skew: now - at,
    status,
    working: str(live.working) ?? 'idle',
    label: str(live.label),
    turnStartedAt: num(live.turnStartedAt),
    phaseSince: num(live.phaseSince),
    after: str(live.after),
    ...(streamKind && streamText !== undefined ? { stream: { kind: streamKind, text: streamText, since: num(stream?.since) ?? at } } : {}),
    tools,
    ...(waiting ? { waiting: { kind: str(waiting.kind) ?? 'other', toolId: str(waiting.toolId) } } : {}),
    settings: settingsOf(live.settings),
    ...(sideText !== undefined ? { side: { text: sideText } } : {}),
  };
}

/** Epoch ms an entry was written, once the office sends it. */
export const entryAt = (entry: ThreadEntry | undefined): number | undefined => num((entry as { at?: unknown } | undefined)?.at);

/** How long the model thought before a thinking entry landed, once the office sends it. */
export const entryTook = (entry: ThreadEntry | undefined): number | undefined => num((entry as { tookMs?: unknown } | undefined)?.tookMs);

const EFFORT: Record<string, string> = { off: 'Off', none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

/** "High" for a `reasoningEffort` id. */
export const effortLabel = (effort: string | undefined) => (effort ? (EFFORT[effort.toLowerCase()] ?? effort) : undefined);

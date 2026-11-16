import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkerAsk, WorkerStatus } from '../shared/protocol.js';
import {
  effortId,
  effortName,
  liveStatus,
  modelOnScreen,
  readLiveScreen,
  readScreenStream,
  readScreenToolOutput,
  sameCommand,
  textSignature,
  type ThreadLive,
  type ThreadLiveTool,
  type ThreadLiveWorking,
  type ThreadSessionSettings,
} from '../shared/thread-live.js';
import type { ThreadEntry } from '../shared/worker-thread.js';
import type { ActiveToolCall } from './worker-queue.js';

/** What the server knows of a local worker's turn, gathered by its WorkerManager (see threadLive). */
export interface ThreadLiveInputs {
  sessionId?: string;
  status: WorkerStatus;
  /** When its current working stretch started. */
  workingSince?: number;
  /** Its activity line: compaction says so (hooks' COMPACTING). */
  activity?: string;
  ask?: WorkerAsk;
  /** The session raising its needs_input, and the tool it asks about. */
  asking?: { session: string; tool?: string };
  /** Running tool calls by session (PreToolUse to PostToolUse). */
  activeTool: ReadonlyMap<string, ActiveToolCall>;
  /** Its terminal's rows now. */
  screen?: readonly string[];
  /** The office's name for a model id. */
  modelName?(id: string): string | undefined;
  /** The model id the office knows by this name. */
  modelId?(name: string): string | undefined;
  /** A rewind the office is driving in its terminal. */
  rewind?: { entryId: string; since: number };
}

/** How often a session's settings file is looked at again while it's watched. */
const SETTINGS_RECHECK_MS = 500;
const OUTPUT_LINES = 40;
/** Hooks name the compaction they wait on (worker-runtime/hooks.ts COMPACTING). */
const COMPACTING = /compacting/i;

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const leaf = (name = '') => name.split(/[.:/]/).at(-1)?.toLowerCase() ?? '';

/** A session's `<id>.settings.json`, as Droid 1.12 writes it beside the conversation file. */
export function readSessionSettings(raw: unknown): ThreadSessionSettings {
  const s = object(raw);
  const out: ThreadSessionSettings = {};
  for (const key of ['model', 'reasoningEffort', 'interactionMode', 'autonomyLevel', 'autonomyMode'] as const) {
    const value = str(s[key]);
    if (value) out[key] = value;
  }
  return out;
}

interface SettingsCache {
  file: string;
  checkedAt: number;
  mtimeMs: number;
  value?: ThreadSessionSettings;
}

interface WorkerLive {
  sessionId?: string;
  rev: number;
  digest?: string;
  working: ThreadLiveWorking;
  phaseSince: number;
  /** First seen, by the start of the text it streams. */
  stream?: { key: string; since: number };
  settings?: SettingsCache;
}

export interface ThreadLiveResult {
  live: ThreadLive;
  /** Whether anything but `at` differs from the last one. */
  changed: boolean;
}

/**
 * Keeps each watched worker's `thread.live`: works out the phase, running tools, the message being
 * written and the session's settings from what the office knows now, and bumps `rev` only when that
 * differs from the last one.
 */
export class ThreadLiveTracker {
  private workers = new Map<string, WorkerLive>();

  constructor(private now: () => number = Date.now) {}

  forget(workerId: string): void {
    this.workers.delete(workerId);
  }

  /** `entries` are the conversation's newest canonical rows; `file` its conversation file. */
  async compute(workerId: string, inputs: ThreadLiveInputs, entries: readonly ThreadEntry[], file?: string): Promise<ThreadLiveResult> {
    const now = this.now();
    let state = this.workers.get(workerId);
    if (!state || state.sessionId !== inputs.sessionId) {
      state = { sessionId: inputs.sessionId, rev: state?.rev ?? 0, working: 'idle', phaseSince: now };
      this.workers.set(workerId, state);
    }
    const screen = inputs.screen ? readLiveScreen(inputs.screen) : undefined;
    const busy = !inputs.rewind && (inputs.status === 'working' || inputs.status === 'starting' || inputs.status === 'needs_input');
    const waitingFor = busy ? this.waiting(inputs) : undefined;
    let working: ThreadLiveWorking = 'idle';
    if (inputs.rewind) working = 'idle';
    else if (waitingFor) working = 'waiting_for_tool_confirmation';
    else if (busy && inputs.activity && COMPACTING.test(inputs.activity)) working = 'compacting_conversation';
    else if (busy && screen?.working) working = screen.working;
    else if (busy && inputs.activeTool.size) working = 'executing_tool';
    else if (busy) working = 'thinking';
    if (working !== state.working) {
      state.working = working;
      state.phaseSince = now;
    }

    const tools = busy ? this.tools(inputs, entries, screen?.transcript) : [];
    let waiting: ThreadLive['waiting'];
    if (waitingFor) {
      const tool = [...entries].reverse().find((e) => e.kind === 'tool' && e.resultSeq === undefined && (!waitingFor.tool || e.name === waitingFor.tool));
      waiting = { kind: waitingFor.kind, ...(tool ? { toolId: tool.id } : {}) };
      for (const t of tools) if (tool && t.id === tool.id) t.phase = 'waiting_permission';
    }

    let stream: ThreadLive['stream'];
    if (busy && screen && !screen.side && (working === 'thinking' || working === 'streaming_assistant_message')) {
      const shown = readScreenStream(screen.transcript);
      if (shown && !landed(shown.text, entries)) {
        const key = `${shown.kind}:${textSignature(shown.text).slice(0, 40)}`;
        if (state.stream?.key !== key) state.stream = { key, since: now };
        stream = { ...shown, since: state.stream.since };
      }
    }
    if (!stream) state.stream = undefined;

    const settings = await this.settings(state, file, now);
    const shown = screen?.model ? modelOnScreen(screen.model) : undefined;
    const merged: ThreadSessionSettings | undefined = settings || shown ? { ...settings } : undefined;
    if (merged && shown) {
      // Droid rewrites the settings file a while after /model or Tab; its mode line shows the change at once.
      const filed = merged.model ? inputs.modelName?.(merged.model) : undefined;
      if (!merged.model || (filed !== undefined && filed !== shown.name)) {
        const id = inputs.modelId?.(shown.name);
        if (id) merged.model = id;
      }
      const effort = shown.effort ? effortId(shown.effort) : undefined;
      if (effort && effortName(merged.reasoningEffort ?? '') !== shown.effort) merged.reasoningEffort = effort;
    }
    if (merged) {
      const name = merged.model ? inputs.modelName?.(merged.model) : undefined;
      if (name ?? shown?.name) merged.modelName = name ?? shown?.name;
    }

    const body: Omit<ThreadLive, 'rev' | 'at'> = {
      status: inputs.rewind ? 'idle' : liveStatus(working, !!waitingFor),
      working,
      ...(inputs.rewind ? { label: 'Rewinding conversation...', rewind: inputs.rewind } : busy && screen?.label ? { label: screen.label } : {}),
      ...(busy && inputs.workingSince ? { turnStartedAt: inputs.workingSince } : {}),
      ...(working !== 'idle' ? { phaseSince: state.phaseSince } : {}),
      ...(entries.length ? { after: entries[entries.length - 1].id } : {}),
      ...(stream ? { stream } : {}),
      tools,
      ...(waiting ? { waiting } : {}),
      ...(merged ? { settings: merged } : {}),
      ...(screen?.side ? { side: screen.side } : {}),
    };
    const digest = JSON.stringify(body);
    const changed = digest !== state.digest;
    if (changed) {
      state.digest = digest;
      state.rev++;
    }
    return { live: { rev: state.rev, at: now, ...body }, changed };
  }

  private waiting(inputs: ThreadLiveInputs): { kind: NonNullable<ThreadLive['waiting']>['kind']; tool?: string } | undefined {
    if (inputs.status !== 'needs_input') return undefined;
    const ask = inputs.ask;
    if (ask?.kind === 'question') return { kind: 'question', tool: 'AskUser' };
    const tool = ask?.tool ?? inputs.asking?.tool;
    if (tool === 'ExitSpecMode') return { kind: 'spec', tool };
    if (ask?.kind === 'permission') return { kind: 'permission', tool };
    return { kind: 'other', ...(tool ? { tool } : {}) };
  }

  /** The turn's calls still without a result, and the subagents' running ones. */
  private tools(inputs: ThreadLiveInputs, entries: readonly ThreadEntry[], transcript?: readonly string[]): ThreadLiveTool[] {
    let start = entries.length;
    while (start > 0 && !(entries[start - 1].role === 'user' && entries[start - 1].kind === 'text')) start--;
    const open = entries.slice(start).filter((e) => e.kind === 'tool' && e.resultSeq === undefined);
    const out: ThreadLiveTool[] = [];
    const claimed = new Set<ActiveToolCall>();
    const own = inputs.sessionId;
    for (const entry of open) {
      const call = own ? inputs.activeTool.get(own) : undefined;
      const mine = call && !claimed.has(call) && call.tool === entry.name;
      if (mine) claimed.add(call);
      out.push({ id: entry.id, name: entry.name ?? 'Tool', startedAt: mine ? call.startedAt : (entry.at ?? this.now()), phase: 'running' });
    }
    for (const [session, call] of inputs.activeTool) {
      if (claimed.has(call) || session === own) continue;
      out.push({ name: call.tool, startedAt: call.startedAt, phase: 'running', session });
    }
    if (transcript) {
      for (const tool of out) {
        if (tool.session || (leaf(tool.name) !== 'execute' && leaf(tool.name) !== 'bash')) continue;
        const entry = open.find((e) => e.id === tool.id);
        const command = str(object(safeJson(entry?.input)).command);
        const shown = readScreenToolOutput(transcript, tool.name, command ? (args) => sameCommand(args, command) : undefined);
        if (!shown) continue;
        tool.output = shown.output.split('\n').slice(-OUTPUT_LINES).join('\n');
        if (shown.more !== undefined) tool.more = shown.more;
      }
    }
    return out;
  }

  private async settings(state: WorkerLive, file: string | undefined, now: number): Promise<ThreadSessionSettings | undefined> {
    if (!file || !state.sessionId) return undefined;
    const target = path.join(path.dirname(file), `${state.sessionId}.settings.json`);
    const cache = state.settings?.file === target ? state.settings : (state.settings = { file: target, checkedAt: 0, mtimeMs: -1 });
    if (now - cache.checkedAt < SETTINGS_RECHECK_MS) return cache.value;
    cache.checkedAt = now;
    const info = await stat(target).catch(() => undefined);
    if (!info) return cache.value;
    if (info.mtimeMs === cache.mtimeMs) return cache.value;
    try {
      cache.value = readSessionSettings(JSON.parse(await readFile(target, 'utf8')));
      cache.mtimeMs = info.mtimeMs;
    } catch {
      // Droid rewrites the file in place: a half-written one is read again next time.
    }
    return cache.value;
  }
}

function safeJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Whether a message read off the screen is already in the conversation file. */
function landed(text: string, entries: readonly ThreadEntry[]): boolean {
  const shown = textSignature(text);
  if (!shown) return true;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.role === 'user' && entry.kind === 'text') break;
    if (entry.role !== 'assistant' || (entry.kind !== 'text' && entry.kind !== 'thinking') || !entry.text) continue;
    if (textSignature(entry.text).includes(shown)) return true;
  }
  return false;
}

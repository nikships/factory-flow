import { extractThreadChanges, threadShortPath, toolLeaf, type ThreadFileChange, type ThreadFileText } from './thread-diff.js';
import { todoItems } from './todos.js';
import type { ThreadEntry } from './worker-thread.js';

export type { ThreadDiffLine, ThreadDiffSpan, ThreadFileChange, ThreadFileText } from './thread-diff.js';

export type ActivityState = 'working' | 'complete' | 'incomplete' | 'failed' | 'cancelled';
export type ActionKind =
  | 'read'
  | 'list'
  | 'search'
  | 'command'
  | 'edit'
  | 'create'
  | 'web'
  | 'webSearch'
  | 'delegate'
  | 'skill'
  | 'ask'
  | 'memory'
  | 'script'
  | 'plan'
  | 'taskStop'
  | 'loopCreate'
  | 'loopList'
  | 'loopPause'
  | 'loopResume'
  | 'loopCancel'
  | 'other';

export type ThreadCardKind = 'change' | 'command' | 'delegate';

/** Factory's per-tool row icon (a Lucide name on each client). */
export type ThreadToolIcon = 'read' | 'search' | 'glob' | 'list' | 'web' | 'link' | 'terminal' | 'edit' | 'create' | 'delete' | 'patch' | 'ask' | 'plan' | 'bot' | 'skill' | 'spec' | 'image' | 'memory' | 'tool';

export interface ThreadCommandMeta {
  command: string;
  summary?: string;
}

export interface ThreadDelegationMeta {
  agent: string;
  role?: string;
  summary: string;
  workerId?: string;
  workerName?: string;
  branch?: string;
}

/** A tool call as the engine reads it. The wire carries a ThreadModelAction instead. */
export interface ThreadAction {
  type: 'action';
  entry: ThreadEntry;
  title: string;
  detail?: string;
  category: ActionKind;
  state: ActivityState;
  paths: string[];
  /** A wrapper's diagnostics remain available, but its child's failure is counted only once. */
  causedBy?: string;
}
export interface PlanStep {
  done: boolean;
  active: boolean;
  text: string;
}

export interface ActivePlan {
  steps: PlanStep[];
  done: number;
  total: number;
  current?: string;
  allDone: boolean;
  stale: boolean;
}

/**
 * The Thread presentation model, built by the office and rendered by the web and Android clients.
 * Raise THREAD_MODEL_VERSION when a change would make an older client read the model wrongly (a
 * renamed or retyped field, a new row or block kind); added optional fields don't need it.
 */
export const THREAD_MODEL_VERSION = 1;
export interface ThreadPresentation {
  version: typeof THREAD_MODEL_VERSION;
  rows: ThreadRow[];
}
/** Where an action's arguments are in its entry's input: a key of the JSON object, '.' for a JSON string, or the whole input. */
export interface ThreadArgumentsRef {
  label: string;
  field?: string;
}
export interface ThreadModelAction {
  /** The tool entry's id: its arguments and result are that entry's input and output. */
  id: string;
  title: string;
  detail?: string;
  category: ActionKind;
  state: ActivityState;
  /** The state in words beside the title, empty when it simply finished. */
  status: string;
  causedBy?: string;
  arguments?: ThreadArgumentsRef;
  /** The heading over the output. */
  result: 'Result' | 'Error' | 'Cancelled';
  open: boolean;
  card?: ThreadCardKind;
  changes?: ThreadFileChange[];
  command?: ThreadCommandMeta;
  delegation?: ThreadDelegationMeta;
  /** The row's icon. */
  icon?: ThreadToolIcon;
  /** The row's action words in the tool-label color ("Read", "Grepped for", "Edit 12 lines"); empty for Execute. */
  verb?: string;
  /** The row's detail after the verb: a short path, pattern, URL, file name or the command's summary. */
  subject?: string;
  /** What a failed row says at its end ("Command failed", "Error editing file"). */
  failedLabel?: string;
}
/**
 * How an Activity's blocks read as Factory rows, in order. Exploration tools and the thoughts between
 * them fold into one summary row; every other call is its own row, except repeating commands and long
 * runs of subagents, which fold too. A live summary at the tail starts open and closes once it stops.
 */
export type ThreadSegment =
  | { kind: 'explore'; id: string; blockIds: string[]; actionIds: string[]; action: string; details: string; providers?: string[]; live: boolean; open: boolean }
  | { kind: 'thought'; blockId: string }
  | { kind: 'tool'; blockId: string; actionId: string }
  | { kind: 'repeat'; id: string; actionIds: string[]; summaries: string[]; times: number; live: boolean; open: boolean }
  | { kind: 'tasks'; id: string; actionIds: string[]; label: string; settled: number; failed: number; live: boolean; open: boolean };
export interface ThreadFailure {
  id: string;
  title: string;
  /** Diagnostic metadata retained for wire compatibility, not a collapsed-row callout. */
  preview: string;
}
/**
 * Three or more tool cards in one Activity fold under one disclosure: the blocks from its first card
 * to its last. It starts open in the latest turn, so its open diffs show, and closed before it.
 */
export interface ThreadToolGroup {
  /** 'group:' + its first block's id. */
  id: string;
  /** The blocks it folds, in order: always consecutive in the Activity's `blocks`. */
  blockIds: string[];
  label: string;
  state: ActivityState;
  live: boolean;
  open: boolean;
  /** Files its finished change cards changed, counted once, and their lines. */
  files: number;
  additions: number;
  deletions: number;
}
export interface ThreadTurnFile {
  path: string;
  shortPath: string;
  additions: number;
  deletions: number;
}
/** What a finished turn changed, on its last message or Activity row. */
export interface ThreadTurnChanges {
  /** Every file the turn's finished change cards changed, counted once. */
  count: number;
  additions: number;
  deletions: number;
  /** The first files it changed, in order. */
  files: ThreadTurnFile[];
}
export type ThreadBlock =
  | { kind: 'thought'; id: string; preview: string; live: boolean; open: boolean }
  | { kind: 'tools'; id: string; label: string; state: ActivityState; live: boolean; open: boolean; card?: ThreadCardKind; actions: ThreadModelAction[]; plan?: PlanStep[] };
/** `from` and `to` are the seqs of the first and last entry a row stands for, hidden ones included. */
export type ThreadRow =
  | { kind: 'message'; id: string; from: number; to: number; role: 'user' | 'assistant'; startsTurn: boolean; turnChanges?: ThreadTurnChanges }
  | { kind: 'notice'; id: string; from: number; to: number; role: ThreadEntry['role']; text: string; tone: 'quiet' | 'danger' | 'attachment' }
  | {
      kind: 'activity';
      id: string;
      from: number;
      to: number;
      sourceIds: string[];
      label: string;
      state: ActivityState;
      live: boolean;
      open: boolean;
      /** Cancellation and missing-result counts, never tool-failure counts. */
      status?: string;
      /** The newest working action's title while live. */
      running?: string;
      failed: ThreadFailure[];
      blocks: ThreadBlock[];
      /** No longer produced: segments say how blocks group. Kept for older offices' snapshots. */
      groups?: ThreadToolGroup[];
      segments?: ThreadSegment[];
      turnChanges?: ThreadTurnChanges;
    };

const bookkeeping = new Set(['todowrite', 'todoread', 'toolsearch', 'skill', 'todo_write', 'todo_read', 'update_plan', 'waitforscript', 'taskoutput']);
const leaf = (name = '') => toolLeaf(name);
const isMemoryTool = (rawName = '') => {
  const lower = rawName.toLowerCase();
  return lower.includes('memory___') || lower.startsWith('mcp__memory__');
};
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const sentence = (text: string) => {
  const line = text.split('\n')[0].trim().replace(/\.$/, '');
  return line.charAt(0).toUpperCase() + line.slice(1);
};
const baseName = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) || path;

function argumentsOf(entry: ThreadEntry): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(entry.input ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractDelegationMeta(entry: ThreadEntry): ThreadDelegationMeta {
  const args = argumentsOf(entry);
  const taskObj = args.task && typeof args.task === 'object' && !Array.isArray(args.task) ? (args.task as Record<string, unknown>) : {};
  const role = str(args.subagent_type) || undefined;
  const output = entry.output ?? '';
  const hired = /Hired ([^\n(]+?)\s+\(([a-z0-9-]+)\)/.exec(output);
  const workerName = hired?.[1]?.trim() || undefined;
  const workerId = hired?.[2]?.trim() || undefined;
  const branch = str(taskObj.branch) || str(args.branch) || /Worktree: \S+ on (\S+?)[.\s]/.exec(output)?.[1]?.trim() || undefined;
  const summary = str(args.title) || str(args.description) || str(taskObj.title) || clip(str(args.prompt).split('\n')[0]?.trim() ?? '', 120) || 'Subagent task';
  const agent = workerName || role || 'Subagent';
  return {
    agent,
    ...(role ? { role } : {}),
    summary,
    ...(workerId ? { workerId } : {}),
    ...(workerName ? { workerName } : {}),
    ...(branch ? { branch } : {}),
  };
}

/** Source is available on demand, formatted as source rather than escaped JSON. */
export function threadArguments(entry: ThreadEntry): ThreadArgumentsRef | undefined {
  const raw = entry.input?.trim();
  if (!raw || raw === '{}') return;
  const args = argumentsOf(entry);
  const name = leaf(entry.name);
  const isPatch = name === 'applypatch' || name === 'apply_patch';
  if (str(args.command)) return { label: 'Command', field: 'command' };
  if (str(args.script)) return { label: 'Script', field: 'script' };
  if (str(args.code)) return { label: 'Script', field: 'code' };
  if (isPatch && str(args.input)) return { label: 'Patch', field: 'input' };
  if (isPatch && str(args.patch)) return { label: 'Patch', field: 'patch' };
  try {
    if (typeof JSON.parse(raw) === 'string') return { label: name === 'script' ? 'Script' : isPatch ? 'Patch' : 'Arguments', field: '.' };
  } catch {
    /* Older tools can record plain-text arguments. */
  }
  return { label: 'Arguments' };
}

/** The text a ThreadArgumentsRef points at in an entry's input. */
export function threadArgumentsText(input: string | undefined, ref: ThreadArgumentsRef): string {
  const raw = input?.trim() ?? '';
  if (ref.field === undefined) return raw;
  try {
    const value: unknown = JSON.parse(raw);
    const picked = ref.field === '.' ? value : value && typeof value === 'object' ? (value as Record<string, unknown>)[ref.field] : undefined;
    return typeof picked === 'string' ? picked.trim() : raw;
  } catch {
    return raw;
  }
}

/** What the office writes in a result or message for each picture in it. */
export const IMAGE_PLACEHOLDER = '[Image attachment]';

/** A tool's result as a client that shows its pictures prints it: without a placeholder line per picture. */
export function threadOutputText(entry: ThreadEntry): string | undefined {
  if (entry.output === undefined || !entry.images?.length) return entry.output;
  return entry.output
    .split('\n')
    .filter((line) => line !== IMAGE_PLACEHOLDER)
    .join('\n')
    .trim();
}

export function threadAction(entry: ThreadEntry, live = false, cancelled = false): ThreadAction {
  const name = leaf(entry.name);
  const args = argumentsOf(entry);
  const path = str(args.file_path ?? args.path ?? args.directory_path ?? args.folder);
  const failed = !!entry.error && !cancelled;
  const action = (category: ActionKind, title: string, detail?: string, paths = path ? [path] : []): ThreadAction => ({
    type: 'action',
    entry,
    category,
    paths,
    title: clip(title, 90),
    ...(detail ? { detail: clip(detail, 70) } : {}),
    state: cancelled ? 'cancelled' : failed ? 'failed' : entry.output !== undefined ? 'complete' : live ? 'working' : 'incomplete',
  });
  const file = path ? baseName(path) : 'a file';
  const detail = path ? threadShortPath(path) : undefined;
  switch (name) {
    case 'read':
      return action('read', `Read ${file}`, detail);
    case 'ls':
      return action('list', `Listed ${path ? baseName(path) : 'a folder'}`, detail);
    case 'glob': {
      const patterns = Array.isArray(args.patterns) ? args.patterns.filter((p) => typeof p === 'string') : [str(args.patterns)].filter(Boolean);
      return action('search', patterns.length ? `Found files matching ${patterns.join(', ')}` : 'Found files', detail);
    }
    case 'grep':
      return action('search', str(args.pattern) ? `Searched for “${clip(str(args.pattern), 48)}”` : 'Searched the code', detail);
    case 'execute': {
      const summary = str(args.summary);
      const command = str(args.command)
        .split('\n')
        .find((line) => line.trim())
        ?.trim()
        .replace(/[^\s'"]*\/\.(?:factory-flow|droid-office)\/worktrees\/[^/\s'"]+\/?/g, '')
        .replace(/\/(?:Users|home)\/[^/\s'"]+\//g, '~/');
      return action('command', summary ? sentence(summary) : 'Ran a command', summary ? undefined : command);
    }
    case 'edit':
    case 'multiedit':
      return action('edit', `Edited ${file}`, detail);
    case 'create':
    case 'write':
      return action('create', `Created ${file}`, detail);
    case 'applypatch':
    case 'apply_patch': {
      const patch = str(args.input ?? args.patch) || entry.input || '';
      let files = [...patch.replace(/\\n/g, '\n').matchAll(/\*\*\* (?:Update|Add|Delete) File: (\S.*)/g)].map((m) => m[1].trim().replace(/[",]+$/, ''));
      if (!files.length) {
        const extracted = extractThreadChanges(entry);
        if (extracted?.length) files = extracted.map((c) => c.path);
      }
      const names = [...new Set(files.map(baseName))];
      return action('edit', names.length ? `Edited ${names.join(', ')}` : 'Edited files', files.length === 1 ? threadShortPath(files[0]) : undefined, files);
    }
    case 'fetchurl': {
      const host = str(args.url)
        .split('://')
        .at(-1)
        ?.split(/[/?]/)[0]
        .replace(/^www\./, '');
      return action('web', host ? `Read ${host}` : 'Read a web page');
    }
    case 'websearch':
      return action('webSearch', str(args.query) ? `Searched the web for “${clip(str(args.query), 48)}”` : 'Searched the web');
    case 'task':
      return action('delegate', str(args.description) ? sentence(str(args.description)) : 'Ran a subagent', str(args.subagent_type));
    case 'team_hire':
    case 'office_worker_spawn': {
      const meta = extractDelegationMeta(entry);
      const hasExplicitTitle = Boolean(str(args.title) || str(args.description) || (args.task && typeof args.task === 'object' && str((args.task as Record<string, unknown>).title)) || str(args.prompt));
      const title = hasExplicitTitle ? sentence(meta.summary) : meta.workerName ? `Hired ${meta.workerName}` : 'Ran a subagent';
      return action('delegate', title, meta.workerName ?? meta.branch);
    }
    case 'skill':
      return action('skill', str(args.skill) ? `${failed ? "Couldn't load" : 'Used'} the ${str(args.skill)} skill` : failed ? "Couldn't load a skill" : 'Used a skill');
    case 'askuser':
      return action('ask', 'Asked you a question');
    case 'script':
      return action('script', 'Ran a script');
    case 'toolsearch':
      return action('plan', failed ? "Couldn't load tools" : 'Loaded tools');
    case 'waitforscript':
      return action('plan', failed ? "Couldn't read script results" : 'Read script results');
    case 'taskoutput':
      return action('plan', failed ? "Couldn't read task output" : 'Read task output');
    case 'taskstop':
      return action('taskStop', failed ? "Couldn't stop the background task" : 'Stopped a background task');
    case 'loop': {
      const verbs: Record<string, [ActionKind, string, string]> = {
        list: ['loopList', 'Checked scheduled loops', "Couldn't read scheduled loops"],
        pause: ['loopPause', 'Paused a loop', "Couldn't pause the loop"],
        resume: ['loopResume', 'Resumed a loop', "Couldn't resume the loop"],
        cancel: ['loopCancel', 'Cancelled a loop', "Couldn't cancel the loop"],
      };
      const [kind, done, error] = verbs[str(args.action)] ?? ['loopCreate', 'Scheduled a loop', "Couldn't schedule the loop"];
      return action(kind, failed ? error : done);
    }
    default:
      if (bookkeeping.has(name)) return action('plan', failed ? "Couldn't update the plan" : 'Updated the plan');
      if (isMemoryTool(entry.name)) return action('memory', /save|update/.test(name) ? 'Saved to memory' : 'Checked memory');
      return action(
        'other',
        `Used ${(entry.name || 'a tool')
          .replace(/___/g, ' ')
          .replace(/_/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toLowerCase()
          .trim()}`,
        str(args.description ?? args.query) || detail,
      );
  }
}

const counts: Record<ActionKind, [string, string]> = {
  read: ['Read a file', 'Read %d files'],
  list: ['Listed a folder', 'Listed %d folders'],
  search: ['Searched the code', 'Searched %d times'],
  command: ['Ran a command', 'Ran %d commands'],
  edit: ['Edited a file', 'Edited %d files'],
  create: ['Created a file', 'Created %d files'],
  web: ['Read a web page', 'Read %d web pages'],
  webSearch: ['Searched the web', 'Searched the web %d times'],
  delegate: ['Ran a subagent', 'Ran %d subagents'],
  skill: ['Used a skill', 'Used %d skills'],
  ask: ['Asked you a question', 'Asked you %d questions'],
  memory: ['Checked memory', 'Used memory %d times'],
  script: ['Ran a script', 'Ran %d scripts'],
  plan: ['Updated the plan', 'Updated the plan %d times'],
  taskStop: ['Stopped a background task', 'Stopped %d background tasks'],
  loopCreate: ['Scheduled a loop', 'Scheduled %d loops'],
  loopList: ['Checked scheduled loops', 'Checked scheduled loops %d times'],
  loopPause: ['Paused a loop', 'Paused %d loops'],
  loopResume: ['Resumed a loop', 'Resumed %d loops'],
  loopCancel: ['Cancelled a loop', 'Cancelled %d loops'],
  other: ['Used a tool', 'Used %d tools'],
};
const controls: Partial<Record<ActionKind, [string, string, string]>> = {
  taskStop: ['stop background tasks', 'Stopping a background task', 'Background task stop cancelled'],
  loopCreate: ['schedule loops', 'Scheduling a loop', 'Loop scheduling cancelled'],
  loopList: ['check scheduled loops', 'Checking scheduled loops', 'Loop check cancelled'],
  loopPause: ['pause loops', 'Pausing a loop', 'Loop pause cancelled'],
  loopResume: ['resume loops', 'Resuming a loop', 'Loop resume cancelled'],
  loopCancel: ['cancel loops', 'Cancelling a loop', 'Loop cancellation cancelled'],
};
function activityLabel(actions: ThreadAction[]): string {
  const counted = actions.filter((action) => !action.causedBy && !(action.state === 'failed' && (action.category === 'plan' || action.category === 'skill')));
  if (!counted.length && actions.length) return (actions.find((action) => !action.causedBy) ?? actions[0]).title;
  const kinds = new Map<ActionKind, Set<string>>();
  for (const action of counted) {
    const units = ['edit', 'create'].includes(action.category) ? (action.paths.length ? action.paths : [action.title]) : [action.entry.id];
    if (!kinds.has(action.category)) kinds.set(action.category, new Set());
    for (const unit of units) kinds.get(action.category)?.add(unit);
  }
  const entries = [...kinds.entries()];
  const parts = entries.slice(0, 3).map(([kind, units]) => {
    const control = controls[kind];
    const group = counted.filter((action) => action.category === kind);
    if (control && units.size === 1) {
      const first = group[0];
      if (first.state === 'cancelled') return control[2];
      return first.state === 'working' || first.state === 'incomplete' ? control[1] : first.title;
    }
    if (control && group.some((action) => action.state !== 'complete')) return `${units.size} attempts to ${control[0]}`;
    return units.size === 1 ? counts[kind][0] : counts[kind][1].replace('%d', String(units.size));
  });
  const folded = new Set(entries.slice(3).map(([kind]) => kind));
  const more = counted.filter((action) => folded.has(action.category)).length;
  if (more) parts.push(`${more} more`);
  return parts.join(' · ') || 'Thought';
}

/** Only the CLI's exact causal error envelope can deduplicate a failed wrapper, not proximity. */
function scriptFailureCause(entry: ThreadEntry, children: ThreadEntry[]): string | undefined {
  const lines = entry.output?.trim().split('\n') ?? [];
  if (lines.length !== 2 || !/^\[Script failed · .* · after call \d+ \(.+\) · log: .+]$/.test(lines[0])) return;
  try {
    const result = JSON.parse(lines[1]);
    if (Object.keys(result).sort().join(',') !== 'error,status,toolCallId') return;
    if (result.status !== 'failed' || result.toolCallId !== entry.id.replace(/^tool:/, '')) return;
    return children.find((child) => child.error && child.output?.trim() && result.error === `Error: tools.${child.name}: ${child.output.trim()}`)?.id;
  } catch {
    return;
  }
}

function scriptChildren(source: ThreadEntry[], at: number): ThreadEntry[] {
  const following = source.slice(at + 1);
  const nextScript = following.findIndex((entry) => entry.kind === 'tool' && leaf(entry.name) === 'script');
  return (nextScript < 0 ? following : following.slice(0, nextScript)).filter((entry) => entry.kind === 'tool');
}

const byUser = /^(?:Error: )?tool execution (?:was )?(?:cancelled|canceled|interrupted|aborted) by (?:the )?user$/i;

/**
 * Results that came only after a later message, notice or Script, or past the loaded entries. The CLI
 * flushes the calls a crash orphaned as "cancelled by user" when the owner later stops another
 * Script, so such a result says nothing about why its call stopped.
 */
function lateResults(entries: readonly ThreadEntry[]): Set<string> {
  const late = new Set<string>();
  const end = (entries.at(-1)?.seq ?? 0) + 1;
  for (const [at, entry] of entries.entries()) {
    const result = entry.resultSeq;
    if (entry.kind !== 'tool' || !entry.error || result === undefined || !byUser.test(entry.output?.trim() ?? '')) continue;
    if (result > end) late.add(entry.id);
    for (let next = at + 1; next < entries.length && entries[next].seq < result && !late.has(entry.id); next++) {
      const other = entries[next];
      if (other.kind === 'text' || other.kind === 'notice' || (other.kind === 'tool' && leaf(other.name) === 'script')) late.add(entry.id);
    }
  }
  return late;
}

/**
 * An exact CLI by-user result that came in time is owner evidence, without a turn notice. A bare
 * "was interrupted" (a crash or restart) stays failed, and so does a Script whose by-user result came
 * late or whose child was interrupted that way: the owner's Stop cancels the running child by user
 * too. Such a Script is counted on its failed child. Never infer across another Script or message.
 */
function ownerCancellations(source: ThreadEntry[], late: Set<string>): { ids: Set<string>; causes: Map<string, string> } {
  const marked = source.filter((entry) => entry.kind === 'tool' && entry.error && byUser.test(entry.output?.trim() ?? ''));
  const ids = new Set(marked.filter((entry) => !late.has(entry.id)).map((entry) => entry.id));
  const causes = new Map<string, string>();
  for (const [at, entry] of source.entries()) {
    if (leaf(entry.name) !== 'script' || !marked.includes(entry)) continue;
    const children = scriptChildren(source, at);
    const failed = children.find((child) => child.error && !ids.has(child.id));
    if (failed?.output?.trim() === 'Tool execution was interrupted') ids.delete(entry.id);
    const cause = ids.has(entry.id) ? children.find((child) => ids.has(child.id)) : failed;
    if (cause) causes.set(entry.id, cause.id);
  }
  return { ids, causes };
}

function threadPlan(text: string): PlanStep[] {
  return text.split('\n').flatMap((line) => {
    const match = /^\d+\.\s*\[(completed|in progress|in_progress|pending)]\s*(.*)$/.exec(line.trim());
    return match ? [{ done: match[1] === 'completed', active: match[1].replace('_', ' ') === 'in progress', text: match[2].trim() }] : [];
  });
}

export function latestThreadPlan(entries: readonly ThreadEntry[], busy: boolean): ActivePlan | undefined {
  let steps: PlanStep[] | undefined;
  let planSeq = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === 'todo') {
      const parsed = threadPlan(entry.text ?? '');
      steps = parsed;
      planSeq = entry.seq;
      break;
    }
    if (entry.kind === 'tool' && !entry.error) {
      const name = leaf(entry.name);
      if (name === 'todowrite' || name === 'todo_write' || name === 'update_plan') {
        const args = argumentsOf(entry);
        if (args.todos === undefined) continue;
        steps = todoItems(args).map((item) => ({
          done: item.status === 'completed',
          active: item.status === 'in_progress',
          text: item.content,
        }));
        planSeq = entry.seq;
        break;
      }
    }
  }
  if (!steps?.length) return undefined;
  const total = steps.length;
  const done = steps.filter((step) => step.done).length;
  const current = steps.find((step) => step.active)?.text;
  const allDone = done === total;
  const stale = allDone && !busy && entries.some((entry) => entry.seq > planSeq && entry.kind === 'text' && entry.role === 'user');
  return {
    steps,
    done,
    total,
    ...(current ? { current } : {}),
    allDone,
    stale,
  };
}

function threadStop(reason: string): string {
  const copy: Record<string, string> = {
    error: 'The turn stopped on an error',
    model_authentication_failed: "The turn stopped: the model's sign-in failed",
    model_provider_unavailable: "The turn stopped: the model's provider couldn't be reached",
    model_provider_unreachable: "The turn stopped: the model's provider couldn't be reached",
    model_rate_limited: 'The turn stopped: the model was rate limited',
    model_request_rejected: 'The turn stopped: the model rejected the request',
    model_usage_exhausted: "The turn stopped: the model's usage ran out",
    permission_rejected: 'The turn stopped: a permission was refused',
  };
  return copy[reason] ?? `The turn stopped: ${reason.replace(/_/g, ' ')}`;
}
function notice(entry: ThreadEntry): Extract<ThreadRow, { kind: 'notice' }> | undefined {
  const text = entry.text?.trim() || entry.name || '';
  const row = (text: string, tone: 'quiet' | 'danger' | 'attachment'): Extract<ThreadRow, { kind: 'notice' }> => ({ kind: 'notice', id: entry.id, from: entry.seq, to: entry.seq, role: entry.role, text, tone });
  if (entry.id.startsWith('turn:') || text.startsWith('Turn ended') || text === 'Turn cancelled') {
    const reason = entry.id.startsWith('turn:') ? entry.id.split(':').at(-1) : text.split('·')[1]?.trim();
    if (text === 'Turn cancelled' || reason === 'cancelled') return row('Turn cancelled', 'quiet');
    return !reason || reason === 'completed' ? undefined : row(threadStop(reason), 'danger');
  }
  if (text === IMAGE_PLACEHOLDER) return row('Image attached', 'attachment');
  return text ? row(text, entry.error ? 'danger' : 'quiet') : undefined;
}

const STATUS: Record<ActivityState, string> = { complete: '', working: 'Running', failed: '', incomplete: 'No result', cancelled: 'Cancelled' };

function cardKindFor(category: ActionKind): ThreadCardKind | undefined {
  if (category === 'edit' || category === 'create') return 'change';
  if (category === 'command') return 'command';
  if (category === 'delegate') return 'delegate';
  return undefined;
}

function modelAction(action: ThreadAction, fileText?: ThreadFileText): ThreadModelAction {
  // A Read that returned a picture shows just the picture: its path is already in the title.
  const args = leaf(action.entry.name) === 'read' && action.entry.images?.length ? undefined : threadArguments(action.entry);
  const card = cardKindFor(action.category);
  const changes = card === 'change' ? extractThreadChanges(action.entry, fileText) : undefined;
  let command: ThreadCommandMeta | undefined;
  if (card === 'command') {
    const parsed = argumentsOf(action.entry);
    const cmd = str(parsed.command);
    const summary = str(parsed.summary);
    command = { command: cmd, ...(summary ? { summary } : {}) };
  }
  const delegation = card === 'delegate' ? extractDelegationMeta(action.entry) : undefined;
  const face = toolFace(action, changes);

  return {
    id: action.entry.id,
    title: action.title,
    ...(action.detail ? { detail: action.detail } : {}),
    category: action.category,
    state: action.state,
    status: STATUS[action.state],
    ...(action.causedBy ? { causedBy: action.causedBy } : {}),
    ...(args ? { arguments: args } : {}),
    result: action.state === 'cancelled' ? 'Cancelled' : action.entry.error ? 'Error' : 'Result',
    open: false,
    ...(card ? { card } : {}),
    ...(changes?.length ? { changes } : {}),
    ...(command ? { command } : {}),
    ...(delegation ? { delegation } : {}),
    ...(face.icon ? { icon: face.icon } : {}),
    verb: face.verb ?? '',
    ...(face.subject ? { subject: face.subject } : {}),
    ...(face.failedLabel ? { failedLabel: face.failedLabel } : {}),
  };
}

const plural = (count: number, one: string, other = `${one}s`) => `${count} ${count === 1 ? one : other}`;
/** English conjunction list, as Intl.ListFormat writes it: "a", "a and b", "a, b, and c". */
export function threadList(items: readonly string[]): string {
  if (items.length < 3) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
/** A path as Factory's tool rows print it: its last three segments. */
export function threadToolPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : path;
}
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : str(value) ? [str(value)] : []);
const more = (items: string[], keep: number) => (items.length > keep ? `${items.slice(0, keep).join(', ')}... (+${items.length - keep} more)` : items.join(', '));
const mcpParts = (rawName = '') => {
  const at = rawName.indexOf('___');
  if (at > 0) return { server: rawName.slice(0, at), tool: rawName.slice(at + 3) };
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(rawName);
  return mcp ? { server: mcp[1], tool: mcp[2] } : undefined;
};
/** A tool or server name as words: "TaskStop" → "Task Stop", "factory-flow" → "Factory Flow". */
export function threadToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || name;
}
const lines = (count: number, verb: string) => (count > 0 ? `${verb} ${plural(count, 'line')}` : `${verb} file`);

type ToolFace = Pick<ThreadModelAction, 'icon' | 'verb' | 'subject' | 'failedLabel'>;

/** How Factory's transcript row for this call reads: its icon, action words and detail. */
function toolFace(action: ThreadAction, changes: readonly ThreadFileChange[] | undefined): ToolFace {
  const entry = action.entry;
  const name = leaf(entry.name);
  const args = argumentsOf(entry);
  const path = str(args.file_path ?? args.path ?? args.directory_path ?? args.folder);
  const fallback: ToolFace = { icon: 'tool', verb: action.title, ...(action.detail ? { subject: action.detail } : {}) };
  const changed = (changes ?? []).reduce((total, change) => total + change.additions + change.deletions, 0);
  const files = [...new Set((changes ?? []).map((change) => baseName(change.path)))].join(', ') || (path ? baseName(path) : action.paths.map(baseName).join(', '));
  const fileFace = (kind: 'added' | 'deleted' | 'modified' | 'mixed'): ToolFace => {
    const [icon, verb, failed]: [ThreadToolIcon, string, string] =
      kind === 'added'
        ? ['create', 'Write', 'Error writing file']
        : kind === 'deleted'
          ? ['delete', 'Delete', 'Error deleting file']
          : kind === 'modified'
            ? ['edit', 'Edit', 'Error editing file']
            : ['patch', 'Change', 'Error changing file'];
    return { icon, verb: lines(changed, verb), ...(files ? { subject: files } : {}), failedLabel: failed };
  };
  switch (name) {
    case 'read': {
      const range = [typeof args.offset === 'number' ? `offset: ${args.offset}` : '', typeof args.limit === 'number' ? `limit: ${args.limit}` : ''].filter(Boolean).join(', ');
      return { icon: 'read', verb: 'Read', subject: [path ? threadToolPath(path) : '', range].filter(Boolean).join(', ') };
    }
    case 'glob': {
      const patterns = strings(args.patterns);
      const excluded = strings(args.excludePatterns ?? args.exclude_patterns);
      const head = [patterns.length ? more(patterns, 3) : '', path ? `in ${threadToolPath(path)}` : ''].filter(Boolean).join(' ');
      const subject = [head, excluded.length ? `excluding ${more(excluded, 2)}` : ''].filter(Boolean).join(', ');
      return { icon: 'glob', verb: 'Searched files for', subject };
    }
    case 'grep': {
      const pattern = str(args.pattern);
      const subject = [pattern ? `"${pattern.length > 30 ? `${pattern.slice(0, 30)}...` : pattern}"` : '', path ? `in ${threadToolPath(path)}` : ''].filter(Boolean).join(' ');
      return { icon: 'search', verb: 'Grepped for', subject };
    }
    case 'ls': {
      const ignored = strings(args.ignorePatterns ?? args.ignore_patterns);
      return { icon: 'list', verb: 'Listed content of', subject: [path ? threadToolPath(path) : 'current directory', ignored.length ? `ignoring ${more(ignored, 2)}` : ''].filter(Boolean).join(', ') };
    }
    case 'websearch':
      return { icon: 'web', verb: 'Searched the web for', subject: str(args.query) ? `"${str(args.query)}"` : '' };
    case 'fetchurl':
      return { icon: 'link', verb: 'Fetch Content', subject: str(args.url) };
    case 'execute': {
      const summary = str(args.summary);
      return { icon: 'terminal', verb: '', subject: summary ? sentence(summary) : (action.detail ?? 'Ran a command'), failedLabel: 'Command failed' };
    }
    case 'edit':
      return fileFace('modified');
    case 'multiedit':
      return { ...fileFace('modified'), icon: 'patch' };
    case 'create':
    case 'write':
      return fileFace('added');
    case 'delete':
      return fileFace('deleted');
    case 'applypatch':
    case 'apply_patch': {
      const kinds = new Set((changes ?? []).map((change) => change.kind));
      return fileFace(kinds.size === 1 ? ([...kinds][0] as 'added' | 'deleted' | 'modified') : kinds.size ? 'mixed' : 'modified');
    }
    case 'task':
      return { icon: 'bot', verb: str(args.subagent_type) || 'Task', subject: str(args.description) || clip(str(args.prompt).split('\n')[0] ?? '', 80) };
    case 'team_hire':
    case 'office_worker_spawn': {
      const meta = extractDelegationMeta(entry);
      return { icon: 'bot', verb: meta.workerName ? `Hired ${meta.workerName}` : (meta.role ?? 'Subagent'), subject: meta.summary };
    }
    case 'askuser': {
      const count = Array.isArray(args.questions) ? Math.max(1, args.questions.length) : Math.max(1, (str(args.questionnaire).match(/^\s*\d+\.\s*\[question]/gm) ?? []).length);
      const asking = action.state === 'working' || action.state === 'incomplete';
      return { icon: 'ask', verb: `${asking ? 'Asking' : 'Asked'} user ${count === 1 ? 'a question' : `${count} questions`}`, failedLabel: 'AskUser failed' };
    }
    case 'exitspecmode':
      return { icon: 'spec', verb: 'Propose Specification', subject: str(args.title) || 'Untitled specification' };
    case 'generateimage':
      return { icon: 'image', verb: 'Generate Image', subject: clip(str(args.prompt), 80), failedLabel: 'Image generation failed' };
    case 'skill':
      return { icon: 'skill', verb: 'Skill', subject: str(args.skill) };
    case 'script':
      return { icon: 'terminal', verb: action.title };
    default: {
      const mcp = mcpParts(entry.name);
      if (mcp) return { icon: isMemoryTool(entry.name) ? 'memory' : 'tool', verb: threadToolName(mcp.tool), subject: str(args.description ?? args.query ?? args.title ?? args.text), failedLabel: 'Tool call failed' };
      if (bookkeeping.has(name)) return { ...fallback, icon: 'plan' };
      return fallback;
    }
  }
}

const EXPLORE = new Set(['read', 'grep', 'glob', 'ls', 'websearch']);
const EXECUTE_PERIOD = 8;
const TASK_GROUP_MIN = 5;

/** Factory's exploration summary words (`toolSummary` in its catalog) for one run of calls and thoughts. */
function exploreLabel(actions: readonly ThreadAction[], thoughts: number, live: boolean): { action: string; details: string; providers?: string[] } {
  const searches = actions.filter((a) => EXPLORE.has(leaf(a.entry.name)));
  const skills = actions.filter((a) => leaf(a.entry.name) === 'skill').length;
  const apps = actions.filter((a) => mcpParts(a.entry.name));
  const thought = live ? 'thinking' : `thought ${plural(thoughts, 'time')}`;
  if (apps.length) {
    const providers = [...new Set(apps.map((a) => threadToolName(mcpParts(a.entry.name)?.server ?? '')))];
    const extras = [searches.length ? plural(searches.length, 'search', 'searches') : '', skills ? `${live ? 'loading' : 'loaded'} ${plural(skills, 'skill')}` : '', thoughts ? thought : ''].filter(Boolean);
    const lead = providers.length > 2 ? plural(providers.length, 'app') : threadList(providers);
    return { action: `${live ? 'Performing' : 'Performed'} ${plural(apps.length, 'action')} in`, details: threadList([lead, ...extras]), providers };
  }
  const extras = [searches.length && skills ? `${live ? 'loading' : 'loaded'} ${plural(skills, 'skill')}` : '', thoughts ? thought : ''].filter(Boolean);
  if (!searches.length) {
    const lead = plural(skills, 'skill');
    return { action: live ? 'Loading' : 'Loaded', details: threadList([lead, ...extras]) };
  }
  const files = !thoughts && searches.every((a) => leaf(a.entry.name) === 'read');
  return { action: live ? 'Exploring' : 'Explored', details: threadList([files ? plural(searches.length, 'file') : plural(searches.length, 'search', 'searches'), ...extras]) };
}

function repeatPeriod(summaries: readonly string[], at: number): number {
  for (let period = 1; period <= EXECUTE_PERIOD && at + period * 2 <= summaries.length; period++) {
    let same = true;
    for (let i = at + period; i < at + period * 2; i++) if (summaries[i] !== summaries[i - period]) same = false;
    if (same) return period;
  }
  return 0;
}

/** The Factory rows an Activity's blocks make, in order (`ThreadSegment`). */
function activitySegments(blocks: readonly ThreadBlock[], actionsOf: ReadonlyMap<string, ThreadAction[]>, live: boolean): ThreadSegment[] {
  type Item = { block: ThreadBlock; action?: ThreadAction; model?: ThreadModelAction };
  const segments: ThreadSegment[] = [];
  let run: Item[] = [];
  const flushRun = () => {
    const items = run;
    run = [];
    const calls = items.filter((item) => item.action);
    if (!calls.length) {
      for (const item of items) segments.push({ kind: 'thought', blockId: item.block.id });
      return;
    }
    const thoughts = items.length - calls.length;
    const first = items[0];
    segments.push({
      kind: 'explore',
      id: `explore:${first.model?.id ?? first.block.id}`,
      blockIds: [...new Set(items.map((item) => item.block.id))],
      actionIds: calls.map((item) => item.model?.id ?? ''),
      ...exploreLabel(
        calls.map((item) => item.action as ThreadAction),
        thoughts,
        false,
      ),
      live: false,
      open: false,
    });
  };
  for (const block of blocks) {
    if (block.kind === 'thought') {
      run.push({ block });
      continue;
    }
    const raw = actionsOf.get(block.id) ?? [];
    for (const [index, model] of block.actions.entries()) {
      const action = raw[index];
      const name = leaf(action?.entry.name);
      if (action && (EXPLORE.has(name) || name === 'skill' || (mcpParts(action.entry.name) && !model.card))) {
        run.push({ block, action, model });
        continue;
      }
      flushRun();
      segments.push({ kind: 'tool', blockId: block.id, actionId: model.id });
    }
  }
  flushRun();
  const models = new Map(blocks.flatMap((block) => (block.kind === 'tools' ? block.actions.map((model) => [model.id, model] as const) : [])));
  const raws = new Map([...actionsOf.values()].flat().map((action) => [action.entry.id, action] as const));
  const folded = foldTools(segments, models, raws, live);
  const tail = folded.at(-1);
  if (live && tail && (tail.kind === 'explore' || tail.kind === 'repeat' || tail.kind === 'tasks')) {
    tail.live = true;
    tail.open = true;
    if (tail.kind === 'explore') {
      const calls = tail.actionIds.map((id) => raws.get(id)).filter((action): action is ThreadAction => !!action);
      const thoughts = tail.blockIds.filter((id) => blocks.find((block) => block.id === id)?.kind === 'thought').length;
      Object.assign(tail, exploreLabel(calls, thoughts, true));
    }
  }
  return folded;
}

/** Repeating Execute summaries and long runs of Task calls fold into one row each. */
function foldTools(segments: ThreadSegment[], models: ReadonlyMap<string, ThreadModelAction>, raws: ReadonlyMap<string, ThreadAction>, live: boolean): ThreadSegment[] {
  const out: ThreadSegment[] = [];
  const nameOf = (segment: ThreadSegment) => (segment.kind === 'tool' ? leaf(raws.get(segment.actionId)?.entry.name) : '');
  const summaryOf = (segment: ThreadSegment) => (segment.kind === 'tool' ? str(argumentsOf(raws.get(segment.actionId)?.entry ?? ({} as ThreadEntry)).summary) : '');
  for (let at = 0; at < segments.length; ) {
    const segment = segments[at];
    if (nameOf(segment) === 'execute' && summaryOf(segment)) {
      let end = at;
      while (end < segments.length && nameOf(segments[end]) === 'execute' && summaryOf(segments[end])) end++;
      const run = segments.slice(at, end);
      const summaries = run.map(summaryOf);
      for (let i = 0; i < run.length; ) {
        const period = repeatPeriod(summaries, i);
        if (!period) {
          out.push(run[i]);
          i++;
          continue;
        }
        let stop = i + period * 2;
        while (stop < summaries.length && summaries[stop] === summaries[stop - period]) stop++;
        const ids = run.slice(i, stop).map((item) => (item.kind === 'tool' ? item.actionId : ''));
        out.push({ kind: 'repeat', id: `repeat:${ids[0]}`, actionIds: ids, summaries: summaries.slice(i, i + period).map(sentence), times: Math.ceil(ids.length / period), live: false, open: false });
        i = stop;
      }
      at = end;
      continue;
    }
    if (nameOf(segment) === 'task') {
      let end = at;
      while (end < segments.length && nameOf(segments[end]) === 'task') end++;
      if (end - at >= TASK_GROUP_MIN) {
        const ids = segments.slice(at, end).map((item) => (item.kind === 'tool' ? item.actionId : ''));
        const tasks = ids.map((id) => models.get(id));
        const types = [...new Set(ids.map((id) => str(argumentsOf(raws.get(id)?.entry ?? ({} as ThreadEntry)).subagent_type)).filter(Boolean))];
        const settled = tasks.filter((task) => task && task.state !== 'working' && task.state !== 'incomplete').length;
        const running = live && settled < ids.length;
        const label = `${running ? 'Running' : 'Ran'} ${types.length === 1 ? `${plural(ids.length, `${types[0]} subagent`)}` : plural(ids.length, 'subagent')}`;
        out.push({ kind: 'tasks', id: `tasks:${ids[0]}`, actionIds: ids, label, settled, failed: tasks.filter((task) => task?.state === 'failed').length, live: running, open: true });
        at = end;
        continue;
      }
    }
    out.push(segment);
    at++;
  }
  return out;
}
const TURN_FILES = 20;

/** What finished change cards changed, by file in first-changed order. A failed or unfinished edit changed nothing known. */
function changeTotals(actions: readonly ThreadModelAction[]): { files: ThreadTurnFile[]; additions: number; deletions: number } {
  const byPath = new Map<string, ThreadTurnFile>();
  let additions = 0;
  let deletions = 0;
  for (const action of actions) {
    if (action.card !== 'change' || action.state !== 'complete') continue;
    for (const change of action.changes ?? []) {
      const file = byPath.get(change.path) ?? { path: change.path, shortPath: change.shortPath, additions: 0, deletions: 0 };
      file.additions += change.additions;
      file.deletions += change.deletions;
      byPath.set(change.path, file);
      additions += change.additions;
      deletions += change.deletions;
    }
  }
  return { files: [...byPath.values()], additions, deletions };
}

/**
 * Turns run from one owner message to the next. Every diff starts closed, as Factory's file rows do; a
 * finished turn's last message or Activity says what it changed.
 */
function finishTurns(rows: ThreadRow[], busy: boolean): void {
  const turns: ThreadRow[][] = [[]];
  for (const row of rows) {
    if (row.kind === 'message' && row.role === 'user') turns.push([]);
    else turns[turns.length - 1].push(row);
  }
  for (const [index, turn] of turns.entries()) {
    const latest = index === turns.length - 1;
    const actions = turn.flatMap((row) => (row.kind === 'activity' ? row.blocks.flatMap((block) => (block.kind === 'tools' && block.card === 'change' ? block.actions : [])) : []));
    for (const change of actions.flatMap((action) => action.changes ?? [])) change.open = false;
    if (latest && busy) continue;
    const totals = changeTotals(actions);
    let last: ThreadRow | undefined;
    for (const row of turn) if (row.kind !== 'notice') last = row;
    if (!totals.files.length || !last || last.kind === 'notice') continue;
    last.turnChanges = { count: totals.files.length, additions: totals.additions, deletions: totals.deletions, files: totals.files.slice(0, TURN_FILES) };
  }
}

/** The state a run's actions add up to. `live` only matters while the run can still be working. */
export function activityState(actions: readonly ThreadModelAction[], live = false): ActivityState {
  const count = (state: ActivityState) => actions.filter((action) => action.state === state && !action.causedBy).length;
  return count('failed') ? 'failed' : live ? 'working' : count('incomplete') ? 'incomplete' : count('cancelled') ? 'cancelled' : 'complete';
}

export interface PresentOptions {
  /** The worker's files as they are now, so Edit and MultiEdit diffs can carry real line numbers. */
  fileText?: ThreadFileText;
}

/**
 * The model the clients render; session entries, positions, paging and the wire entries stay intact.
 * Messages and notices are rows. Everything between them is one Activity row, collapsed, holding
 * its thoughts and tool runs in order, each with its own disclosure.
 */
export function presentThread(entries: readonly ThreadEntry[], busy: boolean, options: PresentOptions = {}): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let section: ThreadEntry[] = [];
  let blocks: ThreadBlock[] = [];
  let blockActions = new Map<string, ThreadAction[]>();
  let actions: ThreadAction[] = [];
  let run: ThreadEntry[] = [];
  let lastPlan = '';
  let plan: PlanStep[] = [];
  let previousRole: ThreadEntry['role'] | undefined;
  const late = lateResults(entries);
  const flushRun = (live: boolean) => {
    if (!run.length) return;
    const source = run;
    run = [];
    const todo = source.filter((entry) => entry.kind === 'todo').at(-1);
    if (todo) plan = threadPlan(todo.text ?? '');
    const items: ThreadAction[] = [];
    const cancellations = ownerCancellations(source, late);
    for (const [index, entry] of source.entries()) {
      if (entry.kind !== 'tool') continue;
      const name = leaf(entry.name);
      if (!entry.error && bookkeeping.has(name)) continue;
      let causedBy = cancellations.causes.get(entry.id);
      if (name === 'script') {
        const children = scriptChildren(source, index);
        if (!entry.error && children.length) continue;
        if (entry.error) causedBy ??= scriptFailureCause(entry, children);
      }
      const action = threadAction(entry, live, cancellations.ids.has(entry.id));
      if (causedBy) {
        action.causedBy = causedBy;
        action.title = action.state === 'cancelled' ? 'Script stopped after a tool was cancelled' : 'Ran a script';
      }
      items.push(action);
    }
    if (!items.length) return;
    actions.push(...items);

    const groups: { card?: ThreadCardKind; items: ThreadAction[] }[] = [];
    let exploration: { items: ThreadAction[] } | undefined;
    for (const item of items) {
      const card = cardKindFor(item.category);
      if (card) {
        exploration = undefined;
        groups.push({ card, items: [item] });
      } else if (exploration) {
        exploration.items.push(item);
      } else {
        exploration = { items: [item] };
        groups.push(exploration);
      }
    }

    const planKey = JSON.stringify(plan);
    const changedPlan = plan.length && planKey !== lastPlan ? plan : undefined;
    if (changedPlan) lastPlan = planKey;

    for (const [groupIndex, group] of groups.entries()) {
      const wired = group.items.map((item) => modelAction(item, options.fileText));
      const isLast = groupIndex === groups.length - 1;
      const blockLive = live && (isLast || wired.some((a) => a.state === 'working'));
      const includePlan = groupIndex === 0 ? changedPlan : undefined;
      blockActions.set(`tools:${group.items[0].entry.id}`, group.items);
      blocks.push({
        kind: 'tools',
        id: `tools:${group.items[0].entry.id}`,
        label: activityLabel(group.items),
        state: activityState(wired, blockLive),
        live: blockLive,
        open: false,
        ...(group.card ? { card: group.card } : {}),
        actions: wired,
        ...(includePlan ? { plan: includePlan } : {}),
      });
    }
  };
  const flush = (live: boolean) => {
    flushRun(live);
    const source = section;
    const shown = blocks;
    const all = actions;
    const segments = activitySegments(shown, blockActions, live);
    section = [];
    blocks = [];
    blockActions = new Map();
    actions = [];
    if (!shown.length) return;
    const failed = all.filter((a) => a.state === 'failed' && !a.causedBy);
    const cancelled = all.filter((a) => a.state === 'cancelled' && !a.causedBy).length;
    const noResult = all.filter((a) => a.state === 'incomplete').length;
    const status = [cancelled ? `${cancelled} cancelled` : '', noResult ? `${noResult} no result` : ''].filter(Boolean).join(' · ');
    const running = live ? all.filter((a) => a.state === 'working').at(-1)?.title : undefined;
    rows.push({
      kind: 'activity',
      id: `activity:${source[0].id}`,
      from: source[0].seq,
      to: Math.max(...source.map((e) => e.seq)),
      sourceIds: source.map((e) => e.id),
      label: activityLabel(all),
      state: activityState(
        all.map((a) => modelAction(a)),
        live,
      ),
      live,
      open: false,
      ...(status ? { status } : {}),
      ...(running ? { running } : {}),
      failed: failed.map((a) => ({
        id: a.entry.id,
        title: a.title,
        preview: clip(
          a.entry.output
            ?.split('\n')
            .find((line) => line.trim())
            ?.trim() ?? 'No error details were recorded.',
          240,
        ),
      })),
      blocks: shown,
      segments,
    });
  };
  const last = entries.at(-1);
  for (const entry of entries) {
    if (entry.kind === 'text' && entry.role !== 'system') {
      flush(false);
      rows.push({ kind: 'message', id: entry.id, from: entry.seq, to: entry.seq, role: entry.role, startsTurn: entry.role === 'assistant' && previousRole !== 'assistant' });
      previousRole = entry.role;
    } else if (entry.kind === 'notice' || (entry.kind === 'text' && entry.role === 'system')) {
      const important = notice(entry);
      if (important) {
        flush(false);
        rows.push(important);
      }
    } else if (entry.kind === 'thinking') {
      flushRun(false);
      section.push(entry);
      const preview = entry.text
        ?.split('\n')
        .find((line) => line.trim())
        ?.trim()
        .replace(/^\*+|\*+$/g, '')
        .trim();
      if (preview) blocks.push({ kind: 'thought', id: entry.id, preview: clip(preview, 120), live: busy && entry === last, open: false });
    } else {
      section.push(entry);
      run.push(entry);
    }
  }
  flush(busy);
  finishTurns(rows, busy);
  return rows;
}

/** The rows a page carries: those standing for any of its entries, before `before` when it is an earlier page. */
export function pageRows(rows: readonly ThreadRow[], entries: readonly ThreadEntry[], before = Infinity): ThreadRow[] {
  const first = entries[0]?.seq;
  if (first === undefined) return [];
  return rows.filter((row) => row.to >= first && row.from < before);
}

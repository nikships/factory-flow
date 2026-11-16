import type { WorkerInfo } from '../../shared/protocol';
import { intralineDiffSpans, type ThreadDiffLine, type ThreadDiffSpan, type ThreadFileChange } from '../../shared/thread-diff';
import { activityState, type ActionKind, type ActivityState, type ThreadBlock, type ThreadDelegationMeta, type ThreadModelAction, type ThreadTurnChanges } from '../../shared/thread-presentation';
import type { ThreadEntry } from '../../shared/worker-thread';
import { highlightLine, MAX_HIGHLIGHT_CHARS, renderCodeFrame, resolveCodeLanguage, tokenizeCode, type CodeToken } from './code-highlight';
import { h } from './dom';
import type { WorkspacePathRef } from './thread-markdown';

// V3 Thread presentation builders and pure helpers: exploration summaries, diff lines (unified +
// intraline + Lezer syntax), tool code sections, delegated-worker lookup and turn change summaries.
// Free of window/document globals at import time so Node unit tests import pure helpers directly.

const HUNK_LINE_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const EXPLORE_COUNTS: Record<ActionKind, [string, string]> = {
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

export interface MergedDiffSegment {
  text: string;
  cls: string;
  changed: boolean;
}

export interface ThreadCardRenderContext {
  owner: WorkerInfo;
  floorDir?: string;
  userToggles: Map<string, boolean>;
  expandedDiffs: Set<string>;
  onOpenPath?: (ref: WorkspacePathRef) => void;
  team?: readonly WorkerInfo[];
  openWorker?: (id: string) => void;
  pictures: (entry: ThreadEntry | undefined, title: string, about?: string, owner?: WorkerInfo) => HTMLElement | null;
  onLayoutChange?: () => void;
  /** Opens the worker's Changes window. */
  openChanges?: () => void;
  /** Puts a workspace file on the floor's Whiteboard as a card. */
  sendToWhiteboard?: (path: string) => void;
}

/** Sets `details.open` while marking `data-expected-open` so programmatic renders never masquerade as user toggles. */
export function setDisclosureOpen<T extends HTMLDetailsElement>(details: T, open: boolean): T {
  details.dataset.expectedOpen = String(open);
  details.open = open;
  return details;
}

/** Converts a relative or worktree/floor-checkout path into a clean workspace-relative path for `/api/thread/file`, or `null` when outside the workspace. */
export function toWorkspaceRelPath(rawPath: string, floorDir?: string): string | null {
  const norm = rawPath.trim().replace(/\\/g, '/');
  if (!norm) return null;

  let candidate = norm;
  const wtMatch = /^.*?\/\.(?:factory-flow|droid-office)\/worktrees\/[^/]+\/(.+)$/.exec(norm);
  if (wtMatch) {
    candidate = wtMatch[1];
  } else if (norm.startsWith('/')) {
    const cleanFloor = floorDir?.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (cleanFloor && norm.startsWith(`${cleanFloor}/`)) {
      candidate = norm.slice(cleanFloor.length + 1);
    } else {
      return null;
    }
  }

  const rel = candidate.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return null;
  if (/(^|\/)\.\.(\/|$)/.test(rel) || /(^|\/)\.(git|factory-flow)(\/|$)/.test(rel)) return null;
  return rel;
}

/** Finds the target line (`newLine ?? oldLine`) at the start of the first hunk in a `ThreadFileChange`. */
export function firstDiffTargetLine(change: ThreadFileChange): number | undefined {
  for (const line of change.lines) {
    if (line.newLine !== undefined) return line.newLine;
    if (line.oldLine !== undefined) return line.oldLine;
  }
  for (const line of change.lines) {
    if (line.kind !== 'hunk') continue;
    const m = HUNK_LINE_RE.exec(line.text);
    if (!m) continue;
    const newL = Number(m[2]);
    const oldL = Number(m[1]);
    if (newL > 0) return newL;
    if (oldL > 0) return oldL;
  }
  return undefined;
}

/** Pairs contiguous `del` + `add` runs within `lines` and computes `intralineDiffSpans` for changed line pairs. */
export function pairIntralineSpans(lines: readonly ThreadDiffLine[]): Map<number, ThreadDiffSpan[]> {
  const out = new Map<number, ThreadDiffSpan[]>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'del') {
      i++;
      continue;
    }
    let delEnd = i;
    while (delEnd < lines.length && lines[delEnd].kind === 'del') delEnd++;
    let addEnd = delEnd;
    while (addEnd < lines.length && lines[addEnd].kind === 'add') addEnd++;

    const pairs = Math.min(delEnd - i, addEnd - delEnd);
    for (let k = 0; k < pairs; k++) {
      const delLine = lines[i + k];
      const addLine = lines[delEnd + k];
      const { del, add } = intralineDiffSpans(delLine.text, addLine.text);
      if (del.some((s) => s.changed)) out.set(i + k, del);
      if (add.some((s) => s.changed)) out.set(delEnd + k, add);
    }
    i = Math.max(delEnd, addEnd);
  }
  return out;
}

/** Intersects Lezer syntax tokens and intraline diff spans over the same line string without losing characters. */
export function mergeSyntaxAndDiffSpans(tokens: readonly CodeToken[], spans: readonly ThreadDiffSpan[]): MergedDiffSegment[] {
  const spanText = spans.map((s) => s.text).join('');
  if (!spanText) return [];
  const tokText = tokens.map((t) => t.text).join('');
  if (!tokens.length || tokText !== spanText) {
    return spans.filter((s) => s.text.length > 0).map((s) => ({ text: s.text, cls: '', changed: Boolean(s.changed) }));
  }

  const out: MergedDiffSegment[] = [];
  let ti = 0;
  let toff = 0;
  let si = 0;
  let soff = 0;

  while (ti < tokens.length && si < spans.length) {
    const tok = tokens[ti];
    const sp = spans[si];
    const trem = tok.text.length - toff;
    const srem = sp.text.length - soff;
    if (trem <= 0) {
      ti++;
      toff = 0;
      continue;
    }
    if (srem <= 0) {
      si++;
      soff = 0;
      continue;
    }
    const step = Math.min(trem, srem);
    const slice = sp.text.slice(soff, soff + step);
    const cls = tok.cls.trim();
    const changed = Boolean(sp.changed);
    const prev = out[out.length - 1];
    if (prev && prev.cls === cls && prev.changed === changed) {
      prev.text += slice;
    } else if (slice) {
      out.push({ text: slice, cls, changed });
    }
    toff += step;
    soff += step;
  }

  return out;
}

/** Resolves a delegation card's subagent worker id against `team` by `workerId` or case-insensitive `workerName`. */
export function resolveDelegatedWorkerId(delegation: ThreadDelegationMeta | undefined, leadId: string, team: readonly WorkerInfo[] | undefined): string | undefined {
  if (!delegation || !team?.length) return undefined;
  if (delegation.workerId) {
    const exact = team.find((w) => w.id === delegation.workerId);
    if (exact) return exact.id;
    if (delegation.workerId.length >= 4) {
      const prefix = team.find((w) => w.id.startsWith(delegation.workerId!));
      if (prefix) return prefix.id;
    }
  }
  if (delegation.workerName) {
    const lower = delegation.workerName.trim().toLowerCase();
    if (lower) {
      const owned = team.find((w) => w.lead === leadId && w.name.toLowerCase() === lower);
      if (owned) return owned.id;
      const anyMatch = team.find((w) => w.name.toLowerCase() === lower);
      if (anyMatch) return anyMatch.id;
    }
  }
  return undefined;
}

function aggregateExploreActionsLabel(actions: readonly ThreadModelAction[]): string {
  const counted = actions.filter((a) => !a.causedBy && !(a.state === 'failed' && (a.category === 'plan' || a.category === 'skill')));
  if (!counted.length && actions.length) return (actions.find((a) => !a.causedBy) ?? actions[0]).title;

  const kinds = new Map<ActionKind, number>();
  for (const action of counted) {
    kinds.set(action.category, (kinds.get(action.category) ?? 0) + 1);
  }
  const entries = [...kinds.entries()];
  const parts = entries.slice(0, 3).map(([kind, count]) => {
    const pair = EXPLORE_COUNTS[kind] ?? EXPLORE_COUNTS.other;
    return count === 1 ? pair[0] : pair[1].replace('%d', String(count));
  });
  const more = entries.slice(3).reduce((total, [, count]) => total + count, 0);
  if (more) parts.push(`${more} more`);
  return parts.join(' · ') || 'Thought';
}

/** Builds the combined summary metadata for a consecutive run of non-card `thought` and `tools` blocks. */
export function summarizeExplorationBlocks(blocks: readonly ThreadBlock[], rowLive: boolean): { label: string; state: ActivityState; live: boolean; status: string } {
  const live = rowLive && blocks.some((b) => b.live);
  const toolBlocks = blocks.filter((b): b is Extract<ThreadBlock, { kind: 'tools' }> => b.kind === 'tools');
  if (!toolBlocks.length) {
    const lastThought = blocks[blocks.length - 1] as Extract<ThreadBlock, { kind: 'thought' }>;
    return {
      label: `Thought · ${lastThought.preview}`,
      state: live ? 'working' : 'complete',
      live,
      status: '',
    };
  }

  const allActions = toolBlocks.flatMap((b) => b.actions);
  let label: string;
  if (toolBlocks.length === 1) label = toolBlocks[0].label;
  else if (toolBlocks.every((b) => b.label === 'Earlier tools')) label = 'Earlier tools';
  else label = aggregateExploreActionsLabel(allActions);

  const cancelled = allActions.filter((a) => a.state === 'cancelled' && !a.causedBy).length;
  const noResult = allActions.filter((a) => a.state === 'incomplete').length;
  const statusParts: string[] = [];
  if (cancelled) statusParts.push(`${cancelled} cancelled`);
  if (noResult) statusParts.push(`${noResult} no result`);
  const status = statusParts.join(' · ');

  return {
    label,
    state: activityState(allActions, live),
    live,
    status,
  };
}

// ------------------------------------------------------------------------------------------------
// DOM Builders (called only inside browser / test DOM contexts, never at module load)

export function renderToolCodeSection(code: string, opts: { lang?: string; copyLabel?: string; isOutput?: boolean }): HTMLElement {
  const frame = renderCodeFrame(code, { lang: opts.lang, copyLabel: opts.copyLabel });
  frame.classList.add('wt-tool-frame');
  if (opts.isOutput) {
    frame.querySelector('pre')?.classList.add('wt-output');
  }
  return frame;
}

function renderMergedSegments(segments: readonly MergedDiffSegment[], wordCls: 'wt-diff-word-add' | 'wt-diff-word-del'): (string | HTMLElement)[] {
  return segments.map((seg) => {
    if (!seg.changed && !seg.cls) return seg.text;
    const classes: string[] = [];
    if (seg.changed) classes.push('wt-diff-word', wordCls);
    if (seg.cls) classes.push(...seg.cls.split(/\s+/).filter(Boolean));
    return h(`span.${classes.join('.')}` as `span.${string}`, {}, seg.text);
  });
}

export function renderDiffLineCode(line: ThreadDiffLine, filePath: string, intraline: readonly ThreadDiffSpan[] | undefined): DocumentFragment | HTMLElement | string {
  if (!line.text) return '\u200b';
  if (!intraline || (line.kind !== 'add' && line.kind !== 'del')) {
    return highlightLine(line.text, filePath);
  }

  const wordCls = line.kind === 'add' ? 'wt-diff-word-add' : 'wt-diff-word-del';
  const initial = renderMergedSegments(mergeSyntaxAndDiffSpans([], intraline), wordCls);
  const holder = h('span.wt-hl-line', {}, ...initial);

  if (line.text.length <= MAX_HIGHLIGHT_CHARS && resolveCodeLanguage(filePath)) {
    void tokenizeCode(line.text, filePath).then((tokens) => {
      if (!holder.isConnected || !tokens.some((t) => t.cls)) return;
      holder.replaceChildren(...renderMergedSegments(mergeSyntaxAndDiffSpans(tokens, intraline), wordCls));
    });
  }
  return holder;
}

function diffStats(additions: number, deletions: number): HTMLElement {
  return h('span.wt-diff-stats', { 'aria-label': `${additions} additions, ${deletions} deletions` }, h('span.wt-diff-add', {}, `+${additions}`), h('span.wt-diff-del', {}, `-${deletions}`));
}

const filesWord = (count: number) => (count === 1 ? '1 file' : `${count} files`);

/** What a finished turn changed (`.wt-card.wt-turn-changes`), each file opening in place and the whole in the Changes window. */
export function renderTurnChanges(changes: ThreadTurnChanges, ctx: Pick<ThreadCardRenderContext, 'floorDir' | 'onOpenPath' | 'openChanges'>): HTMLElement {
  const files = changes.files.map((file) => {
    const rel = ctx.onOpenPath ? toWorkspaceRelPath(file.path, ctx.floorDir) : null;
    const name = rel ? h('button.wt-change-path.wt-file-link', { type: 'button', title: file.path, onclick: () => ctx.onOpenPath?.({ path: rel }) }, file.shortPath) : h('span.wt-change-path', { title: file.path }, file.shortPath);
    return h('li.wt-turn-file', {}, name, diffStats(file.additions, file.deletions));
  });
  const more = changes.count - changes.files.length;
  return h(
    'section.wt-card.wt-turn-changes',
    { 'aria-label': 'Changes in this turn' },
    h(
      'div.wt-turn-head',
      {},
      h('span.wt-turn-title', {}, `Changed ${filesWord(changes.count)}`),
      diffStats(changes.additions, changes.deletions),
      ctx.openChanges ? h('button.btn.sm.wt-turn-review', { type: 'button', onclick: () => ctx.openChanges?.() }, 'Review changes') : null,
    ),
    h('ul.wt-turn-files', {}, ...files, more > 0 ? h('li.wt-turn-more', {}, `and ${more} more`) : null),
  );
}

import { compactDiffRows, threadDeliverable, type ThreadFileChange } from '../../shared/thread-diff';
import { threadArgumentsText, threadOutputText, type ThreadBlock, type ThreadModelAction, type ThreadRow, type ThreadSegment } from '../../shared/thread-presentation';
import type { ThreadEntry } from '../../shared/worker-thread';
import { copy } from './clipboard';
import { highlightLine } from './code-highlight';
import { h } from './dom';
import { icon } from './icons';
import { firstDiffTargetLine, pairIntralineSpans, renderDiffLineCode, renderToolCodeSection, resolveDelegatedWorkerId, toWorkspaceRelPath, type ThreadCardRenderContext } from './thread-diff-view';
import { summaryGroup, toolRow, type ToolRowState } from './thread-tool-row';
import { toolGlyph, type ToolGlyph } from './thread-tool-icons';

// An Activity row drawn the way Factory's transcript draws a turn's tools: flat rows, exploration folded
// into summary groups, Execute with its terminal output, file changes as compact diffs.

type ActivityRow = Extract<ThreadRow, { kind: 'activity' }>;
type ThoughtBlock = Extract<ThreadBlock, { kind: 'thought' }>;

/** What `thread.live` says about a running call (`ThreadLiveTool`, read structurally). */
export interface ThreadLiveToolView {
  phase?: string;
  startedAt?: number;
  output?: string;
  more?: number;
}

export interface ThreadActivityContext extends ThreadCardRenderContext {
  /** The shell's thinking block for a thought. */
  thought: (block: ThoughtBlock, entry: ThreadEntry | undefined) => HTMLElement;
  /** The live overlay for a canonical tool id, while it runs. */
  live?: (id: string) => ThreadLiveToolView | undefined;
}

/** Factory folds an Execute body to this many lines (`ceil(200 / (13 * 1.55)) + 1`) until expanded. */
const COMMAND_CLAMP_LINES = 11;
/** After this long a running command says it can be opened to watch it. */
const PROGRESS_HINT_MS = 15_000;
const EXIT_OK = /\n?\[Process exited with code 0\]\s*$/;
const COPY_RESET_MS = 2000;

const basename = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) || path;
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

function rowState(action: ThreadModelAction, rowLive: boolean, live: ThreadLiveToolView | undefined): ToolRowState {
  if (live?.phase === 'waiting_permission') return 'pending';
  switch (action.state) {
    case 'working':
      return 'working';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'interrupted';
    case 'incomplete':
      return rowLive ? 'working' : 'complete';
    default:
      return 'complete';
  }
}

function argumentsOf(entry: ThreadEntry | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(entry?.input ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const missing = (what: string) => h('p.wt-detail-missing', {}, `Load earlier messages to see ${what}.`);

/** A 12px icon button for a row's header end. */
function headerButton(glyph: ToolGlyph, label: string, onclick: (button: HTMLButtonElement) => void, cls = ''): HTMLButtonElement {
  const button = h('button.wt-tr-button', { type: 'button', class: cls, title: label, 'aria-label': label, 'data-row-action': 'true' }, toolGlyph(glyph, 12));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onclick(button);
  });
  return button;
}

function copyButton(text: () => string): HTMLButtonElement {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return headerButton('copy', 'Copy contents', (button) => {
    void copy(text()).then((ok) => {
      const label = ok ? 'Copied' : 'Failed to copy contents';
      button.replaceChildren(toolGlyph(ok ? 'check' : 'alert', 12));
      button.title = label;
      button.setAttribute('aria-label', label);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        button.replaceChildren(toolGlyph('copy', 12));
        button.title = 'Copy contents';
        button.setAttribute('aria-label', 'Copy contents');
      }, COPY_RESET_MS);
    });
  });
}

// ------------------------------------------------------------------------------------------------
// Execute

function commandOutput(action: ThreadModelAction, entry: ThreadEntry | undefined, live: ThreadLiveToolView | undefined, hasImages: boolean): string {
  const raw = action.state === 'working' && live?.output !== undefined ? live.output : entry ? ((hasImages ? threadOutputText(entry) : entry.output) ?? '') : '';
  return raw.replace(EXIT_OK, '').replace(/\s+$/, '');
}

/** Writes Factory's terminal body (`$ cmd`, then the output) into `pre`, folding it past the clamp. */
function fillCommand(pre: HTMLElement, command: string, output: string, working: boolean, more = 0): number {
  const lines = output ? output.split('\n') : [];
  pre.replaceChildren(
    h('span.wt-cmd-row', {}, h('span.wt-cmd-dollar', { 'aria-hidden': 'true' }, '$ '), h('span.wt-cmd-text', {}, highlightLine(command, 'sh'))),
    more > 0 ? h('span.wt-cmd-row.is-muted', {}, `... ${more} more`) : '',
    ...lines.map((line) => h('span.wt-cmd-row', { class: !line.trim() || line.startsWith('$') ? 'is-muted' : /^Tool execution cancelled/.test(line) ? 'is-cancelled' : '' }, line || '\u200b')),
    working && !lines.length ? h('span.wt-cmd-row.wt-cmd-wait', {}, 'Waiting for command output...') : '',
  );
  return 1 + lines.length + (more > 0 ? 1 : 0);
}

function commandBody(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, images: HTMLElement | null): HTMLElement {
  const command = action.command?.command || action.detail || action.title;
  const live = ctx.live?.(action.id);
  const working = action.state === 'working';
  if (!entry && !live) return h('div.wt-cmd-body', {}, missing('what this command returned'));
  const output = commandOutput(action, entry, live, !!images);
  const pre = h('pre.wt-cmd-out', { 'data-command': command, ...(working ? { 'data-live-tool': action.id } : {}) });
  const count = fillCommand(pre, command, output, working, live?.more);
  const clamp = h('div.wt-cmd-clamp', { class: count > COMMAND_CLAMP_LINES ? 'is-clamped' : '' }, pre);
  const expand = h('button.wt-cmd-expand', { type: 'button', 'aria-label': 'Expand command output' }, toolGlyph('chevronDown', 12));
  expand.addEventListener('click', () => {
    clamp.classList.remove('is-clamped');
    clamp.dataset.expanded = 'true';
    ctx.onLayoutChange?.();
  });
  clamp.append(expand);
  return h('div.wt-cmd-body', {}, clamp, images);
}

/** Refreshes running commands' output in place from `thread.live`, without repainting their rows. */
export function refreshLiveOutput(root: ParentNode, live: (id: string) => ThreadLiveToolView | undefined): void {
  for (const pre of root.querySelectorAll<HTMLElement>('pre[data-live-tool]')) {
    const view = live(pre.dataset.liveTool ?? '');
    if (view?.output === undefined) continue;
    const count = fillCommand(pre, pre.dataset.command ?? '', view.output.replace(EXIT_OK, '').replace(/\s+$/, ''), true, view.more);
    pre.parentElement?.classList.toggle('is-clamped', count > COMMAND_CLAMP_LINES && !pre.parentElement.dataset.expanded);
  }
}

function executeRow(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, rowLive: boolean, nested: boolean): HTMLElement {
  const command = action.command?.command || action.detail || action.title;
  const live = ctx.live?.(action.id);
  const state = rowState(action, rowLive, live);
  const images = entry ? ctx.pictures(entry, action.title, command, ctx.owner) : null;
  let hint: HTMLElement | null = null;
  // `at` arrives with the live Thread layer (ThreadEntry.at); older offices don't send it.
  const started = live?.startedAt ?? entry?.at;
  if (state === 'working' && started !== undefined) {
    hint = h('span.wt-tr-hint', { hidden: true }, 'Click to see progress');
    const show = () => {
      if (hint) hint.hidden = false;
    };
    const wait = PROGRESS_HINT_MS - (Date.now() - started);
    if (wait <= 0) show();
    else setTimeout(show, wait);
  }
  return toolRow({
    id: action.id,
    scope: ctx.owner.id,
    toggles: ctx.userToggles,
    open: false,
    onLayoutChange: ctx.onLayoutChange,
    icon: 'terminal',
    verb: nested ? 'Ran' : '',
    subject: action.subject || action.command?.summary || command,
    subjectTitle: command,
    state,
    failedLabel: action.failedLabel ?? 'Command failed',
    hideFailedWhenOpen: true,
    inlineSubtitle: hint,
    dense: nested,
    headerEnd: copyButton(() => `$ ${command}\n${commandOutput(action, entry, ctx.live?.(action.id), !!images)}`.trimEnd()),
    body: () => commandBody(action, entry, ctx, images),
    testId: 'execute-row',
  });
}

// ------------------------------------------------------------------------------------------------
// File changes

function changeVerb(change: ThreadFileChange): string {
  const count = change.additions + change.deletions;
  const verb = change.kind === 'added' ? 'Write' : change.kind === 'deleted' ? 'Delete' : 'Edit';
  return count ? `${verb} ${plural(count, 'line')}` : `${verb} file`;
}

const changeIcon = (change: ThreadFileChange): ToolGlyph => (change.kind === 'added' ? 'create' : change.kind === 'deleted' ? 'delete' : 'edit');

function diffStats(additions: number, deletions: number): HTMLElement {
  return h('span.wt-tr-stats', { 'aria-label': `${additions} additions, ${deletions} deletions` }, h('span.wt-diff-add', {}, `+${additions}`), h('span.wt-diff-del', {}, `-${deletions}`));
}

/** Factory's file diff: one line-number column, a change marker, and runs of context folded away. */
function renderCompactDiff(change: ThreadFileChange): HTMLElement {
  const paired = pairIntralineSpans(change.lines);
  const numbered = change.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined);
  const rows = compactDiffRows(change.lines).map((row) => {
    if (row.kind === 'hidden') return h('tr.wt-diff-row.is-hidden', {}, h('td.wt-diff-hidden', { colspan: 3 }, plural(row.count, 'hidden line')));
    const { line } = row;
    const number = line.kind === 'del' ? line.oldLine : (line.newLine ?? line.oldLine);
    return h(
      `tr.wt-diff-row.is-${line.kind}` as `tr.${string}`,
      {},
      h('td.wt-diff-num', { 'aria-hidden': 'true' }, number !== undefined ? String(number) : ''),
      h('td.wt-diff-mark', { 'aria-hidden': 'true' }),
      h('td.wt-diff-code', {}, renderDiffLineCode(line, change.path, paired.get(row.index))),
    );
  });
  const table = h('table.wt-diff-table.is-compact', { class: numbered ? '' : 'is-unnumbered' }, h('tbody', {}, ...rows));
  return h('div.wt-diff-scroll', { tabindex: 0, 'aria-label': `Diff for ${basename(change.path)}` }, table);
}

function changeBody(change: ThreadFileChange | undefined, action: ThreadModelAction, entry: ThreadEntry | undefined): HTMLElement {
  const failed = action.state === 'failed' && entry?.output ? renderToolCodeSection(entry.output, { lang: 'txt', copyLabel: 'Copy error', isOutput: true }) : null;
  if (!change) return h('div.wt-diff-body', {}, failed ?? (entry ? h('p.wt-diff-note', {}, 'No diff available') : missing('what this edit changed')));
  return h(
    'div.wt-diff-body',
    {},
    change.lines.length ? renderCompactDiff(change) : h('p.wt-diff-note', {}, 'No diff available'),
    change.truncated ? h('p.wt-diff-note', {}, 'Diff preview truncated. Open the file to see the rest.') : null,
    failed,
  );
}

/** Preview and Send to Whiteboard for a created file the owner may want to look at or share. */
function deliverableActions(relPath: string, ctx: ThreadActivityContext): HTMLElement {
  const stop = (fn: () => void) => (event: Event) => {
    event.stopPropagation();
    fn();
  };
  return h(
    'span.wt-tr-actions',
    {},
    h('button.wt-tr-action.wt-change-preview', { type: 'button', 'data-row-action': 'true', onclick: stop(() => ctx.onOpenPath?.({ path: relPath })) }, icon('file', 12), 'Preview'),
    ctx.sendToWhiteboard ? h('button.wt-tr-action.wt-change-board', { type: 'button', 'data-row-action': 'true', onclick: stop(() => ctx.sendToWhiteboard?.(relPath)) }, icon('board', 12), 'Send to Whiteboard') : null,
  );
}

function changeRows(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, rowLive: boolean, nested: boolean): HTMLElement[] {
  const state = rowState(action, rowLive, ctx.live?.(action.id));
  const base = { scope: ctx.owner.id, toggles: ctx.userToggles, open: false, onLayoutChange: ctx.onLayoutChange, state, chip: true, hideFailedWhenOpen: true, dense: nested, testId: 'change-row' } as const;
  const changes = action.changes ?? [];
  if (!changes.length) {
    return [toolRow({ ...base, id: action.id, icon: action.icon ?? 'edit', verb: action.verb || action.title, subject: action.subject ?? action.detail, failedLabel: action.failedLabel, body: () => changeBody(undefined, action, entry) })];
  }
  return changes.map((change) => {
    const name = basename(change.path);
    const rel = ctx.onOpenPath ? toWorkspaceRelPath(change.path, ctx.floorDir) : null;
    const line = firstDiffTargetLine(change);
    const open = rel ? headerButton('external', `Open ${name}`, () => ctx.onOpenPath?.({ path: rel, ...(line !== undefined ? { line } : {}) }), 'wt-change-open') : null;
    const deliverable = rel && action.state === 'complete' && change.kind === 'added' && threadDeliverable(change.path) ? deliverableActions(rel, ctx) : null;
    return toolRow({
      ...base,
      id: `change:${action.id}:${change.path}`,
      icon: changes.length === 1 && action.icon ? action.icon : changeIcon(change),
      verb: changes.length === 1 && action.verb ? action.verb : changeVerb(change),
      subject: name,
      subjectTitle: change.path,
      chipEnd: diffStats(change.additions, change.deletions),
      failedLabel: action.failedLabel,
      headerEnd: open,
      headerAlways: deliverable,
      body: () => changeBody(change, action, entry),
    });
  });
}

// ------------------------------------------------------------------------------------------------
// Subagents, questions, specs and everything else

function resultSections(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, lang: string, empty: string): (HTMLElement | null)[] {
  if (!entry) return [missing('what this call was given and returned')];
  const images = ctx.pictures(entry, action.title, action.detail, ctx.owner);
  const output = images ? threadOutputText(entry) : entry.output;
  const args = action.arguments ? threadArgumentsText(entry.input, action.arguments) : '';
  const field = action.arguments?.field;
  const argLang = field === 'command' ? 'sh' : field === 'patch' || field === 'input' ? 'diff' : lang;
  return [
    args ? h('div.wt-detail-label', {}, action.arguments?.label ?? 'Input') : null,
    args ? renderToolCodeSection(args, { lang: argLang, copyLabel: `Copy ${(action.arguments?.label ?? 'input').toLowerCase()}` }) : null,
    output || !images ? h('div.wt-detail-label', {}, action.result) : null,
    output ? renderToolCodeSection(output, { lang, copyLabel: 'Copy output', isOutput: true }) : !images ? h('p.wt-tool-empty', {}, action.state === 'working' ? 'Pending...' : empty) : null,
    images,
  ];
}

function taskRow(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, rowLive: boolean, nested: boolean): HTMLElement {
  const delegation = action.delegation ?? { agent: 'Subagent', summary: action.title };
  const target = ctx.openWorker ? resolveDelegatedWorkerId(delegation, ctx.owner.id, ctx.team) : undefined;
  const open = target ? h('button.wt-tr-action.wt-delegate-open', { type: 'button', 'data-row-action': 'true', onclick: () => ctx.openWorker?.(target) }, 'Open thread', toolGlyph('arrowRight', 12)) : null;
  return toolRow({
    id: action.id,
    scope: ctx.owner.id,
    toggles: ctx.userToggles,
    open: false,
    onLayoutChange: ctx.onLayoutChange,
    icon: 'bot',
    verb: action.verb || delegation.agent,
    subject: action.subject ?? delegation.summary,
    state: rowState(action, rowLive, ctx.live?.(action.id)),
    failedLabel: action.failedLabel,
    headerAlways: open,
    dense: nested,
    body: () => h('div.wt-tool-body', {}, ...resultSections(action, entry, ctx, 'md', 'No report recorded in this session.')),
    testId: 'task-row',
  });
}

function genericRow(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, rowLive: boolean, asking: boolean, nested: boolean): HTMLElement {
  const state = rowState(action, rowLive, ctx.live?.(action.id));
  const name = action.icon;
  const waiting = asking && state === 'working';
  const status = name === 'ask' && waiting ? 'Waiting for your answer' : name === 'spec' && waiting ? 'Awaiting review' : undefined;
  return toolRow({
    id: action.id,
    scope: ctx.owner.id,
    toggles: ctx.userToggles,
    open: false,
    onLayoutChange: ctx.onLayoutChange,
    icon: action.icon ?? 'tool',
    verb: action.verb ?? action.title,
    subject: action.verb === undefined ? action.detail : action.subject,
    state,
    failedLabel: action.failedLabel,
    status,
    dense: nested,
    body: () => h('div.wt-tool-body', {}, ...resultSections(action, entry, ctx, name === 'spec' ? 'md' : 'txt', 'No result')),
    testId: 'tool-row',
  });
}

/** An exploration call inside a summary group: one dense line; a Read opens its file. */
function exploreRow(action: ThreadModelAction, entry: ThreadEntry | undefined, ctx: ThreadActivityContext, rowLive: boolean): HTMLElement {
  const state = rowState(action, rowLive, ctx.live?.(action.id));
  const args = argumentsOf(entry);
  const path = action.icon === 'read' ? args.file_path : undefined;
  const rel = typeof path === 'string' && ctx.onOpenPath && state === 'complete' ? toWorkspaceRelPath(path, ctx.floorDir) : null;
  const offset = args.offset;
  const withImages = !!entry?.images?.length;
  return toolRow({
    id: action.id,
    scope: ctx.owner.id,
    toggles: ctx.userToggles,
    open: false,
    icon: action.icon ?? 'tool',
    verb: action.verb ?? action.title,
    subject: action.verb === undefined ? action.detail : action.subject,
    state,
    failedLabel: action.failedLabel,
    dense: true,
    ...(withImages ? { body: () => h('div.wt-tool-body', {}, ...resultSections(action, entry, ctx, 'txt', 'No result')) } : {}),
    ...(rel && !withImages ? { onActivate: () => ctx.onOpenPath?.({ path: rel, ...(typeof offset === 'number' && offset > 0 ? { line: offset } : {}) }) } : {}),
    testId: 'explore-row',
  });
}

// ------------------------------------------------------------------------------------------------

/** Each block as its own row, for an older office's snapshot that has no `segments`. */
function plainSegments(blocks: readonly ThreadBlock[]): ThreadSegment[] {
  return blocks.flatMap((block): ThreadSegment[] => (block.kind === 'thought' ? [{ kind: 'thought', blockId: block.id }] : block.actions.map((action) => ({ kind: 'tool', blockId: block.id, actionId: action.id }))));
}

/** Draws an Activity row's tools into `node` (an `article.wt-entry`) as Factory's transcript does. */
export function renderThreadActivity(node: HTMLElement, row: ActivityRow, loaded: ReadonlyMap<string, ThreadEntry>, asking: boolean, ctx: ThreadActivityContext): HTMLElement {
  node.classList.add('activity');
  const blocks = new Map(row.blocks.map((block) => [block.id, block] as const));
  const actions = new Map(row.blocks.flatMap((block) => (block.kind === 'tools' ? block.actions.map((action) => [action.id, { action, block }] as const) : [])));
  let working = false;
  const rowLive = row.live && !asking;

  const toolNodes = (id: string, nested: boolean): HTMLElement[] => {
    const found = actions.get(id);
    if (!found) return [];
    const { action, block } = found;
    if (action.state === 'working') working = true;
    const entry = loaded.get(action.id);
    const card = action.card ?? block.card;
    if (card === 'change') return changeRows(action, entry, ctx, row.live, nested);
    if (card === 'command') return [executeRow(action, entry, ctx, row.live, nested)];
    if (card === 'delegate') return [taskRow(action, entry, ctx, row.live, nested)];
    return [genericRow(action, entry, ctx, row.live, asking, nested)];
  };

  for (const segment of row.segments ?? plainSegments(row.blocks)) {
    if (segment.kind === 'thought') {
      const block = blocks.get(segment.blockId);
      if (block?.kind === 'thought') node.append(ctx.thought(block, loaded.get(block.id)));
      continue;
    }
    if (segment.kind === 'tool') {
      node.append(...toolNodes(segment.actionId, false));
      continue;
    }
    const live = segment.live && rowLive;
    const group = { id: segment.id, scope: ctx.owner.id, toggles: ctx.userToggles, open: segment.open && !asking, onLayoutChange: ctx.onLayoutChange, live };
    if (segment.kind === 'explore') {
      const ids = new Set(segment.actionIds);
      const rows: Node[] = [];
      for (const blockId of segment.blockIds) {
        const block = blocks.get(blockId);
        if (block?.kind === 'thought') rows.push(ctx.thought(block, loaded.get(block.id)));
        else if (block) for (const action of block.actions) if (ids.has(action.id)) rows.push(exploreRow(action, loaded.get(action.id), ctx, row.live));
      }
      const providers = segment.providers?.length
        ? h('span.wt-sg-providers', {}, ...segment.providers.slice(0, 3).map((provider) => h('span.wt-sg-provider', { title: provider }, toolGlyph(provider.toLowerCase().includes('memory') ? 'memory' : 'tool', 14))))
        : null;
      node.append(summaryGroup({ ...group, action: segment.action, details: segment.details, lead: providers, rows, testId: 'explore-group' }));
    } else if (segment.kind === 'repeat') {
      const rows = segment.actionIds.flatMap((id) => toolNodes(id, true));
      node.append(summaryGroup({ ...group, action: segment.summaries.join(' → '), details: `${segment.times} times`, lead: toolGlyph('terminal', 14), rows, testId: 'repeat-group' }));
    } else {
      const rows = segment.actionIds.flatMap((id) => toolNodes(id, true));
      const end = h('span.wt-sg-meta', {}, segment.failed ? h('span.wt-sg-failed', {}, `${segment.failed} failed`) : null, h('span.wt-sg-count', {}, `${segment.settled}/${segment.actionIds.length}`));
      node.append(summaryGroup({ ...group, action: segment.label, details: '', lead: toolGlyph('bot', 14), headerEnd: end, rows, testId: 'tasks-group' }));
    }
  }

  if (rowLive && !working && row.running && row.running !== row.label) node.append(h('p.wt-running', { role: 'status' }, row.running));
  return node;
}

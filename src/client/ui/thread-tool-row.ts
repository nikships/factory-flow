import { h } from './dom';
import { type ToolGlyph, toolGlyph } from './thread-tool-icons';

// Factory's two transcript disclosures: the summary group (`KH`, "Explored 4 files") and the tool row
// (`toolContainer`, "Read .../a/b.ts"). Both open with a height reveal and close the same way, keep
// the owner's choice in `toggles`, and animate a close the office makes on its own (a live group
// finishing) from where the owner last saw it.

const OPEN_MS = 280;
const CLOSE_MS = 200;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Factory eases an automatic close evenly so it doesn't drag the followed bottom of the transcript. */
const AUTO_CLOSE_EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';
const SEEN_LIMIT = 2000;
const seen = new Map<string, boolean>();

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function remember(key: string, open: boolean): void {
  seen.delete(key);
  seen.set(key, open);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value as string);
}

/** Opens or closes `content` with Factory's height reveal; `auto` uses its automatic-close easing. */
export function revealContent(content: HTMLElement, open: boolean, auto = false, onDone?: () => void): void {
  const running = (content as HTMLElement & { _reveal?: Animation })._reveal;
  running?.cancel();
  content.style.overflow = '';
  content.classList.remove('is-revealing', 'is-concealing');
  if (reducedMotion() || typeof content.animate !== 'function') {
    content.hidden = !open;
    onDone?.();
    return;
  }
  content.hidden = false;
  const height = content.scrollHeight;
  const frames = open ? [{ height: '0px' }, { height: `${height}px` }] : [{ height: `${content.offsetHeight}px` }, { height: '0px' }];
  content.style.overflow = 'hidden';
  const animation = content.animate(frames, { duration: open ? OPEN_MS : CLOSE_MS, easing: auto && !open ? AUTO_CLOSE_EASE : EASE, fill: 'both' });
  (content as HTMLElement & { _reveal?: Animation })._reveal = animation;
  content.classList.toggle('is-revealing', open);
  content.classList.toggle('is-concealing', !open);
  animation.onfinish = () => {
    animation.cancel();
    content.style.overflow = '';
    content.classList.remove('is-revealing', 'is-concealing');
    if (!open) content.hidden = true;
    onDone?.();
  };
}

export interface DisclosureState {
  /** The disclosure's key in `toggles` and `data-disclosure`. */
  id: string;
  /** Where it starts when the owner hasn't chosen. */
  open: boolean;
  toggles: Map<string, boolean>;
  /** Scopes the remembered open state to one Thread (the worker's id). */
  scope: string;
  onLayoutChange?: () => void;
}

/** Wires `trigger` to show and hide `content`, returning whether it renders open. */
function wireDisclosure(root: HTMLElement, trigger: HTMLButtonElement, content: HTMLElement, state: DisclosureState, label: () => string): boolean {
  const key = `${state.scope}:${state.id}`;
  const chosen = state.toggles.get(state.id);
  const open = chosen ?? state.open;
  const wasOpen = seen.get(key);
  const set = (next: boolean) => {
    root.classList.toggle('is-open', next);
    trigger.setAttribute('aria-expanded', String(next));
    trigger.setAttribute('aria-label', `${next ? 'Collapse' : 'Expand'} ${label()}`);
    remember(key, next);
  };
  set(open);
  content.hidden = !open;
  // The office closed it (a live group finishing) while it was on screen: close it in front of the owner.
  if (!open && wasOpen && chosen === undefined) {
    content.hidden = false;
    root.classList.add('is-open');
    requestAnimationFrame(() => {
      if (!root.isConnected) return void (content.hidden = true);
      root.classList.remove('is-open');
      revealContent(content, false, true, state.onLayoutChange);
    });
  }
  trigger.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest('[data-row-action]')) return;
    const next = !root.classList.contains('is-open');
    state.toggles.set(state.id, next);
    set(next);
    root.classList.toggle('is-staggered', next);
    revealContent(content, next, false, state.onLayoutChange);
  });
  return open;
}

export interface SummaryGroupOptions extends DisclosureState {
  action: string;
  details: string;
  /** Shimmers the label while the group is still working. */
  live: boolean;
  lead?: Node | null;
  headerEnd?: Node | null;
  rows: Node[];
  testId?: string;
}

/** Factory's summary group (`KH`): "Explored 4 searches and thought 1 time" over its rows. */
export function summaryGroup(opts: SummaryGroupOptions): HTMLElement {
  const label = `${opts.action}${opts.details ? ` ${opts.details}` : ''}`;
  const trigger = h(
    'button.wt-sg-trigger',
    { type: 'button', 'data-transcript-row': 'true' },
    opts.lead ? h('span.wt-sg-lead', {}, opts.lead) : null,
    h('span.wt-sg-label', { class: opts.live ? 'is-shimmer' : '', title: label }, h('span.wt-sg-action', {}, opts.action), opts.details ? ' ' : null, opts.details ? h('span.wt-sg-details', {}, opts.details) : null),
    h('span.wt-caret', { 'aria-hidden': 'true' }, toolGlyph('chevronDown', 12)),
    opts.headerEnd ? h('span.wt-sg-end', {}, opts.headerEnd) : null,
  );
  const rows = h('div.wt-sg-rows', {}, ...opts.rows.map((row, index) => h(`div.wt-sg-row.is-i${Math.min(index, 4)}` as `div.${string}`, {}, row)));
  const content = h('div.wt-sg-content', {}, h('div.wt-sg-scroll', {}, rows));
  const root = h('div.wt-sg', { 'data-disclosure': opts.id, class: opts.live ? 'is-live' : '', ...(opts.testId ? { 'data-testid': opts.testId } : {}) }, trigger, content);
  const open = wireDisclosure(root, trigger, content, opts, () => label);
  root.classList.toggle('is-staggered', opts.live && open);
  trigger.addEventListener('click', () => root.classList.remove('is-staggered'));
  const scroll = content.firstElementChild as HTMLElement;
  // Like Factory, a live group follows its newest row until the owner scrolls it.
  if (opts.live)
    requestAnimationFrame(() => {
      if (scroll.isConnected && scroll.dataset.touched !== 'true') scroll.scrollTop = scroll.scrollHeight;
    });
  const touched = () => (scroll.dataset.touched = 'true');
  for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) scroll.addEventListener(event, touched, { passive: true });
  const fade = () => {
    const over = scroll.scrollHeight > scroll.clientHeight + 1;
    scroll.parentElement?.toggleAttribute('data-top-fade', over && scroll.scrollTop > 0);
    scroll.parentElement?.toggleAttribute('data-bottom-fade', over && scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1);
  };
  scroll.addEventListener('scroll', fade, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(fade).observe(rows);
  return root;
}

export type ToolRowState = 'complete' | 'working' | 'failed' | 'interrupted' | 'pending';

export interface ToolRowOptions extends DisclosureState {
  icon?: ToolGlyph;
  /** The action words, in the tool-label color. */
  verb: string;
  /** The detail after the verb, tertiary and ellipsized. */
  subject?: string;
  /** Draws the subject in a chip (file rows), with `chipEnd` (their +N -M) inside it. */
  chip?: boolean;
  chipEnd?: Node | null;
  subjectTitle?: string;
  state: ToolRowState;
  failedLabel?: string;
  /** Hides the failed label while open, as Execute and file rows do. */
  hideFailedWhenOpen?: boolean;
  /** Shown only while open (copy, open file). */
  headerEnd?: Node | null;
  /** Shown always (Open thread). */
  headerAlways?: Node | null;
  /** Right-aligned status words in place of the state label ("Awaiting review"). */
  status?: string;
  inlineSubtitle?: Node | null;
  /** Nested rows inside a group are 28px. */
  dense?: boolean;
  /** Builds the body when the row can open; omit for rows that never open. */
  body?: () => Node;
  /** A click on a row that never opens. */
  onActivate?: () => void;
  testId?: string;
}

/** Factory's tool row (`toolContainer` / `t4`): icon, verb, subject, state, and a bordered body. */
export function toolRow(opts: ToolRowOptions): HTMLElement {
  const label = [opts.verb, opts.subject].filter(Boolean).join(' ');
  const subjectEl = opts.subject ? h('span.wt-tr-subject', { title: opts.subjectTitle ?? opts.subject }, opts.subject) : null;
  const titleEl = opts.chip && subjectEl ? h('span.wt-tr-chip', {}, subjectEl, opts.chipEnd ?? null) : subjectEl;
  const interactive = !!opts.body && opts.state !== 'pending';
  const trigger = h(
    'button.wt-tr-trigger',
    { type: 'button', disabled: !interactive && !opts.onActivate, ...(interactive || opts.onActivate ? {} : { tabindex: -1 }) },
    opts.icon ? h('span.wt-tr-icon', {}, toolGlyph(opts.icon, 14)) : null,
    opts.verb ? h('span.wt-tr-verb', { class: opts.state === 'working' && !opts.subject ? 'is-shimmer' : '' }, opts.verb) : null,
    titleEl ? (opts.state === 'working' && !opts.chip ? (titleEl.classList.add('is-shimmer'), titleEl) : titleEl) : null,
    opts.inlineSubtitle ?? null,
    interactive ? h('span.wt-caret', { 'aria-hidden': 'true' }, toolGlyph('chevronDown', 12)) : null,
  );
  const stateLabel = opts.status ?? (opts.state === 'failed' ? (opts.failedLabel ?? 'Error') : opts.state === 'interrupted' ? 'interrupted' : opts.state === 'pending' ? 'Pending review' : '');
  const head = h(
    'div.wt-tr-head',
    { class: interactive ? 'is-interactive' : '' },
    trigger,
    opts.headerEnd ? h('span.wt-tr-end.is-open-only', {}, opts.headerEnd) : null,
    opts.headerAlways ? h('span.wt-tr-end', {}, opts.headerAlways) : null,
    stateLabel ? h('span.wt-tr-state', { class: `is-${opts.state}${opts.hideFailedWhenOpen ? ' hides-open' : ''}` }, stateLabel) : null,
  );
  const root = h('div.wt-tr', { class: `is-${opts.state}${opts.dense ? ' is-dense' : ''}`, 'data-disclosure': opts.id, ...(opts.testId ? { 'data-testid': opts.testId } : {}) }, head);
  if (!interactive) {
    if (opts.onActivate) trigger.addEventListener('click', () => opts.onActivate?.());
    trigger.setAttribute('aria-label', label);
    return root;
  }
  const box = h('div.wt-tr-box');
  const content = h('div.wt-tr-content', {}, box);
  root.append(content);
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    box.append(opts.body?.() ?? '');
  };
  const open = wireDisclosure(root, trigger, content, opts, () => label);
  if (open || !content.hidden) build();
  trigger.addEventListener('click', build, { capture: true });
  return root;
}

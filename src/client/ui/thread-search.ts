import { h } from './dom';
import { icon } from './icons';

/**
 * Factory's chat search (Cmd+F / Ctrl+F): a panel over the conversation's top-right corner that marks every
 * match and steps through them. Marks are CSS Custom Highlights, so a row the Thread paints again keeps no
 * stale markup and the transcript's DOM is never rewritten; ranges are found again after each paint.
 */
export interface ThreadSearch {
  element: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Finds the matches again after the transcript changed, keeping the current one where it can. */
  refresh(): void;
  dispose(): void;
}

const ALL = 'wt-search';
const CURRENT = 'wt-search-current';
const live = new Map<object, { ranges: Range[]; current?: Range }>();

function publish() {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  const all: Range[] = [];
  const current: Range[] = [];
  for (const { ranges, current: c } of live.values()) {
    for (const range of ranges) if (range !== c) all.push(range);
    if (c) current.push(c);
  }
  if (all.length) CSS.highlights.set(ALL, new Highlight(...all));
  else CSS.highlights.delete(ALL);
  if (current.length) CSS.highlights.set(CURRENT, new Highlight(...current));
  else CSS.highlights.delete(CURRENT);
}

/** Every case-insensitive match of [query] in the visible text under [root], in document order. */
function findRanges(root: Element, query: string): Range[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const visible = new Map<Element, boolean>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.toLowerCase() ?? '';
    if (text.length < needle.length) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    let shown = visible.get(parent);
    if (shown === undefined) {
      shown = !parent.closest('[data-search-skip]') && parent.checkVisibility();
      visible.set(parent, shown);
    }
    if (!shown) continue;
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

export function mountThreadSearch(root: () => Element[], reveal: (range: Range) => void): ThreadSearch {
  const key = {};
  let ranges: Range[] = [];
  let index = 0;
  let open = false;
  let timer = 0;
  const input = h('input.wt-search-input', { type: 'search', placeholder: 'Search session', 'aria-label': 'Search chat transcript', spellcheck: 'false', tabindex: -1 });
  const count = h('span.wt-search-count', { 'aria-live': 'polite' }, '0 / 0 results');
  const button = (label: string, glyph: Parameters<typeof icon>[0], size: number, onclick: () => void) => h('button.wt-search-btn', { type: 'button', 'aria-label': label, title: label, tabindex: -1, onclick }, icon(glyph, size));
  const prev = button('Previous chat search match', 'chevron', 14, () => step(-1));
  prev.classList.add('wt-search-prev');
  const next = button('Next chat search match', 'chevron', 14, () => step(1));
  next.classList.add('wt-search-next');
  const close = button('Close chat search', 'x', 12, () => api.close());
  const element = h('div.wt-search', { role: 'search', 'data-search-skip': '', 'aria-hidden': 'true' }, h('span.wt-search-icon', { 'aria-hidden': 'true' }, icon('search', 13)), input, prev, next, count, close);

  const paint = () => {
    const query = input.value.trim();
    count.textContent = query ? `${ranges.length ? index + 1 : 0} / ${ranges.length} results` : '0 / 0 results';
    prev.disabled = next.disabled = !ranges.length;
    if (open && ranges.length) live.set(key, { ranges, current: ranges[index] });
    else live.delete(key);
    publish();
  };
  const find = (keep: boolean) => {
    const previous = keep ? ranges[index] : undefined;
    ranges = open ? root().flatMap((el) => findRanges(el, input.value)) : [];
    index = 0;
    if (previous) {
      // Keep the reader on the same match after a repaint: the first one at or after where it was.
      const at = ranges.findIndex((range) => {
        try {
          return range.compareBoundaryPoints(Range.START_TO_START, previous) >= 0;
        } catch {
          return false;
        }
      });
      index = at >= 0 ? at : Math.max(0, ranges.length - 1);
    }
    paint();
  };
  const step = (by: number) => {
    if (!ranges.length) return;
    index = (index + by + ranges.length) % ranges.length;
    paint();
    reveal(ranges[index]);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      find(false);
      if (ranges.length) reveal(ranges[index]);
    }, 80);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      api.close();
    }
  });

  const api: ThreadSearch = {
    element,
    get isOpen() {
      return open;
    },
    open() {
      open = true;
      element.classList.add('open');
      element.setAttribute('aria-hidden', 'false');
      for (const el of [input, prev, next, close]) el.tabIndex = 0;
      input.focus();
      input.select();
      find(false);
    },
    close() {
      if (!open) return;
      open = false;
      element.classList.remove('open');
      element.setAttribute('aria-hidden', 'true');
      for (const el of [input, prev, next, close]) el.tabIndex = -1;
      ranges = [];
      paint();
    },
    refresh() {
      if (open && input.value.trim()) find(true);
    },
    dispose() {
      clearTimeout(timer);
      live.delete(key);
      publish();
    },
  };
  return api;
}

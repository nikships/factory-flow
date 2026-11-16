import { claimEscape, h } from './dom';
import { mdIcon } from './thread-md-icons';

// Factory's quote reply: select text in a Droid reply and an "Add to chat" pill floats over the
// selection; choosing it hands the text, as a Markdown quote, to whoever owns the composer.

/** The attribute that marks a quotable reply (Factory's `data-response-message-id`). */
export const QUOTABLE_ATTR = 'data-response-message-id';

const GAP = 8;
const EDGE = 8;
const PILL_HEIGHT = 26;

/** `text` as a Markdown blockquote followed by a blank line, ready for the composer. */
export function quoteAsMarkdown(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return '';
  return `${lines.map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n`;
}

/** Where the pill sits for a selection box: centered on it, above when there is room, inside the viewport. */
export function quotePillPosition(rect: { top: number; bottom: number; left: number; width: number }, halfWidth: number, viewport: { width: number; height: number }): { top: number; left: number; above: boolean } {
  const above = rect.top - GAP - PILL_HEIGHT >= EDGE;
  const top = above ? rect.top - GAP : Math.min(rect.bottom + GAP, viewport.height - EDGE - PILL_HEIGHT);
  const min = EDGE + halfWidth;
  const left = Math.min(Math.max(rect.left + rect.width / 2, min), viewport.width - min);
  return { top, left, above };
}

function selectedQuote(container: HTMLElement): { text: string; rect: DOMRect } | undefined {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount !== 1) return undefined;
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const el = common instanceof Element ? common : common.parentElement;
  if (!el || !container.contains(el)) return undefined;
  const own = el.closest(`[${QUOTABLE_ATTR}]`);
  if (own) {
    const text = sel.toString().trim();
    return text ? { text, rect: range.getBoundingClientRect() } : undefined;
  }
  const roots = [...container.querySelectorAll(`[${QUOTABLE_ATTR}]`)].filter((r) => range.intersectsNode(r));
  const parts: string[] = [];
  for (const root of roots) {
    const part = document.createRange();
    part.selectNodeContents(root);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    const t = part.toString().trim();
    if (t) parts.push(t);
  }
  if (!parts.length) return undefined;
  return { text: parts.join('\n\n'), rect: range.getBoundingClientRect() };
}

/**
 * Shows Factory's "Add to chat" pill for selections inside `[data-response-message-id]` replies
 * under `container`, calling `onQuote` with the selection as a Markdown quote. Returns a detach.
 */
export function attachQuoteReply(container: HTMLElement, onQuote: (quote: string, text: string) => void, enabled: () => boolean = () => true): () => void {
  const button = h('button.wt-quote-btn', { type: 'button' }, mdIcon('textQuote', 14), h('span', {}, 'Add to chat'));
  const pill = h('div.wt-quote-pill', { role: 'toolbar', 'aria-label': 'Selection actions' }, button);
  let current: string | undefined;
  let dragging = false;
  let releaseEsc: (() => void) | undefined;

  const hide = () => {
    current = undefined;
    pill.remove();
    releaseEsc?.();
    releaseEsc = undefined;
  };
  const place = () => {
    if (!enabled()) return hide();
    const hit = selectedQuote(container);
    if (!hit || (hit.rect.width === 0 && hit.rect.height === 0)) return hide();
    current = hit.text;
    if (!pill.isConnected) document.body.append(pill);
    // Inside a window, Esc hides the pill before it would close the window.
    releaseEsc ??= claimEscape(container, () => {
      if (!pill.isConnected) return false;
      hide();
      return true;
    });
    const half = (pill.offsetWidth || 112) / 2;
    const pos = quotePillPosition(hit.rect, half, { width: innerWidth, height: innerHeight });
    pill.style.top = `${pos.top}px`;
    pill.style.left = `${pos.left}px`;
    pill.classList.toggle('above', pos.above);
  };

  // Keep the selection when the pill is pressed.
  pill.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', () => {
    const text = current;
    hide();
    window.getSelection()?.removeAllRanges();
    if (text) onQuote(quoteAsMarkdown(text), text);
  });

  const onDown = (e: PointerEvent) => {
    if (pill.contains(e.target as Node)) return;
    dragging = e.button === 0;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    place();
  };
  const onSelection = () => {
    if (dragging || pill.contains(document.activeElement)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hide();
    else if (current !== undefined) place();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && pill.isConnected) hide();
    else if (e.shiftKey && !dragging) requestAnimationFrame(place);
  };
  const onMove = () => {
    if (current !== undefined) place();
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  document.addEventListener('selectionchange', onSelection);
  document.addEventListener('keyup', onKey, true);
  document.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
  return () => {
    hide();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('selectionchange', onSelection);
    document.removeEventListener('keyup', onKey, true);
    document.removeEventListener('scroll', onMove, true);
    window.removeEventListener('resize', onMove);
  };
}

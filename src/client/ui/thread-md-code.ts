import { highlightCodeBlock } from './code-highlight';
import { h } from './dom';
import { wireIconCopy } from './thread-md-icons';

// Factory's chat code block: language header with an icon copy button, wrapped (not scrolled)
// lines, and a "Show more" footer once a block passes ten lines.

/** Blocks longer than this many lines start collapsed. */
export const CODE_COLLAPSE_LINES = 10;

/** The header label Factory shows: the fence language as written, or `code` for none or plaintext. */
export function codeBlockLabel(lang: string | undefined): string {
  const l = (lang ?? '').trim();
  return l && l.toLowerCase() !== 'plaintext' ? l : 'code';
}

/** Whether `code` is long enough to start collapsed behind "Show more". */
export function codeBlockCollapses(code: string): boolean {
  return code.split('\n').length > CODE_COLLAPSE_LINES;
}

/** A Thread Markdown code block (`.wt-md-code`). */
export function renderMdCodeBlock(code: string, lang?: string): HTMLElement {
  const label = codeBlockLabel(lang);
  const copy = h('button.wt-md-code-copy', { type: 'button' });
  wireIconCopy(copy, () => code, { idle: 'Copy code', done: 'Code copied' });

  const pre = h('pre.wt-md-code-pre', {}, highlightCodeBlock(code, label === 'code' ? undefined : label));
  const body = h('div.wt-md-code-body', { 'data-testid': 'code-block-content' }, pre);
  const block = h('div.wt-md-code', { 'data-testid': 'code-block' }, h('div.wt-md-code-head', { 'data-testid': 'code-block-header' }, h('span.wt-md-code-lang', {}, label), copy), body);

  if (codeBlockCollapses(code)) {
    body.classList.add('collapsed');
    const toggle = h('button.wt-md-code-more', { type: 'button', 'aria-expanded': 'false' }, 'Show more');
    toggle.addEventListener('click', () => {
      const open = body.classList.contains('collapsed');
      body.classList.toggle('collapsed', !open);
      body.classList.toggle('expanded', open);
      toggle.textContent = open ? 'Show less' : 'Show more';
      toggle.setAttribute('aria-expanded', String(open));
    });
    block.append(h('div.wt-md-code-foot', { 'data-testid': 'code-block-footer' }, toggle));
  }
  return block;
}

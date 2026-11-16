import { STATUS_FADE_MS, STATUS_ROTATE_MS, STATUS_TOOLTIP, pickPhrase, statusPhrases, type ThreadStatusMode } from '../../shared/thread-status';
import { h } from './dom';

export interface ThreadStatusRowState {
  show: boolean;
  running: boolean;
  /** Stable accessible copy ("Working…"), separate from the decorative rotating phrase. */
  label: string;
  mode: ThreadStatusMode;
  detail?: string;
}

/** Factory's status strip, with the office's stable live-region label kept alongside its phrase. */
export function mountThreadStatusRow() {
  const label = h('span.wt-progress-label.wt-sr-only');
  const phrase = h('span.wt-status-phrase', { 'aria-hidden': 'true', title: STATUS_TOOLTIP });
  const detail = h('span.wt-progress-detail', { hidden: true });
  const element = h(
    'div.wt-progress',
    { hidden: true },
    h(
      'div.wt-progress-line',
      {},
      h('span.wt-progress-glyph', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span')),
      h('span.wt-progress-status', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, label),
      phrase,
      detail,
    ),
  );
  let state: ThreadStatusRowState = { show: false, running: false, label: '', mode: 'idle' };
  let index = -1;
  let rotatedAt = 0;
  let fading = false;
  let fadeTimer = 0;

  const rotate = (now: number) => {
    const pool = statusPhrases(state.mode);
    if (!state.show || !pool.length) {
      phrase.textContent = '';
      index = -1;
      return;
    }
    index = pickPhrase(pool.length, index);
    phrase.textContent = pool[index];
    rotatedAt = now;
  };
  const timer = window.setInterval(() => {
    const now = Date.now();
    if (!state.show || state.mode === 'idle' || document.hidden || fading || now - rotatedAt < STATUS_ROTATE_MS) return;
    if (state.mode === 'compacting') {
      rotatedAt = now;
      return;
    }
    fading = true;
    phrase.classList.add('changing');
    fadeTimer = window.setTimeout(() => {
      fading = false;
      phrase.classList.remove('changing');
      rotate(now);
    }, STATUS_FADE_MS / 2);
  }, 100);

  return {
    element,
    paint(next: ThreadStatusRowState) {
      const modeChanged = next.mode !== state.mode || next.show !== state.show;
      state = next;
      element.hidden = !next.show;
      element.classList.toggle('running', next.show && next.running);
      element.dataset.mode = next.mode;
      if (label.textContent !== next.label) label.textContent = next.label;
      const text = next.show ? (next.detail ?? '') : '';
      if (detail.textContent !== text) detail.textContent = text;
      detail.title = text ? `Latest activity: ${text}` : '';
      detail.hidden = !text;
      if (modeChanged) {
        window.clearTimeout(fadeTimer);
        fading = false;
        phrase.classList.remove('changing');
        rotate(Date.now());
      }
    },
    dispose() {
      window.clearInterval(timer);
      window.clearTimeout(fadeTimer);
      element.hidden = true;
    },
  };
}

import { relativeTime } from '../../shared/thread-status';
import { copy } from './clipboard';
import { h } from './dom';
import { icon } from './icons';

export interface ThreadMessageActionsOptions {
  text: () => string;
  at?: number;
  rewind?: () => void;
  /** The existing Show all control stays beside Factory's hover actions. */
  more?: HTMLElement;
}

/** The hover bar under a message: rewind/copy and Factory's narrow relative timestamp. */
export function threadMessageActions(opts: ThreadMessageActionsOptions): HTMLElement {
  const copyButton = h('button.wt-msg-action', { type: 'button', 'aria-label': 'Copy message', title: 'Copy message' }, icon('copy', 12));
  let copiedTimer = 0;
  copyButton.addEventListener('click', async () => {
    if (!(await copy(opts.text()))) return;
    copyButton.classList.add('copied');
    copyButton.replaceChildren(icon('check', 12));
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copyButton.classList.remove('copied');
      copyButton.replaceChildren(icon('copy', 12));
    }, 2000);
  });
  const children: HTMLElement[] = [];
  if (opts.rewind) {
    children.push(h('button.wt-msg-action.wt-msg-rewind', { type: 'button', 'aria-label': 'Rewind conversation to this message', title: 'Rewind conversation to this message', onclick: opts.rewind }, icon('back', 12)));
  }
  children.push(copyButton);
  if (opts.at !== undefined) {
    const time = h('time.wt-msg-time', { datetime: new Date(opts.at).toISOString(), title: new Date(opts.at).toLocaleString() }, relativeTime(opts.at, Date.now()));
    time.dataset.at = String(opts.at);
    children.push(time);
  }
  if (opts.more) children.push(opts.more);
  return h('div.wt-message-actions.wt-msg-actions', {}, ...children);
}

/** Keeps timestamps current without repainting the message or losing a selection. */
export function refreshMessageTimes(root: ParentNode, now = Date.now()) {
  for (const el of root.querySelectorAll<HTMLElement>('.wt-msg-time[data-at]')) {
    const at = Number(el.dataset.at);
    if (!Number.isFinite(at)) continue;
    const text = relativeTime(at, now);
    if (el.textContent !== text) el.textContent = text;
  }
}

import { threadCopyText, type ThreadCopyChoice } from '../../shared/thread-turns';
import type { ThreadEntry } from '../../shared/worker-thread';
import { copy } from './clipboard';
import { h, openModal, toast } from './dom';

const CHOICES: { id: ThreadCopyChoice; label: string }[] = [
  { id: 'reply', label: 'Last assistant response' },
  { id: 'prompt', label: 'Last user prompt' },
  { id: 'session', label: 'Current session ID' },
  { id: 'transcript', label: 'Full conversation transcript' },
];

/** Droid's /copy menu: a reply, a prompt, the session id, the transcript or the last turns, to the clipboard. */
export function openThreadCopy(opts: { entries: readonly ThreadEntry[]; sessionId?: string }) {
  const turns = h('input.wt-copy-turns', { type: 'number', min: 1, value: 1, inputmode: 'numeric', 'aria-label': 'Turns to copy' });
  const pick = async (choice: ThreadCopyChoice) => {
    const text = threadCopyText(opts.entries, choice, { sessionId: opts.sessionId, turns: Number(turns.value) || 1 });
    if (!text) {
      toast(choice === 'session' ? 'This worker has no session yet.' : 'Nothing to copy yet.', 'warn');
      return;
    }
    if (!(await copy(text).catch(() => false))) {
      toast('Could not copy to the clipboard', 'warn');
      return;
    }
    modal.close();
    toast('Copied to the clipboard', 'info');
  };
  const content = h(
    'div.modal.sm.wt-copy',
    { role: 'dialog', 'aria-label': 'Copy' },
    h('header', {}, h('div.titles', {}, h('h2', {}, 'Copy'))),
    h(
      'div.body.stack',
      {},
      ...CHOICES.map((choice) => h('button.btn.wt-copy-choice', { type: 'button', onclick: () => void pick(choice.id) }, choice.label)),
      h('div.wt-copy-range', {}, h('button.btn.wt-copy-choice', { type: 'button', onclick: () => void pick('turns') }, 'Select range'), h('label', {}, 'Last', turns, 'turns')),
    ),
    h('footer', {}, h('span.grow'), h('button.btn.ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel')),
  );
  const modal = openModal(content);
  content.querySelector<HTMLButtonElement>('.wt-copy-choice')?.focus();
}

import type { RewindFile } from '../../shared/thread-rewind';
import { h, openModal, toast } from './dom';

export type ThreadRewindRestore = 'files' | 'conversation' | 'choose';

export interface ThreadRewindOptions {
  busy: boolean;
  text?: string;
  /** The files the conversation changed after this message, for "Choose files to restore". */
  files?: readonly RewindFile[];
  send: (restore: ThreadRewindRestore, files?: string[]) => Promise<string | undefined>;
}

export function openThreadRewind(opts: ThreadRewindOptions) {
  if (opts.busy) {
    toast('Rewind is only available while Droid is idle.', 'warn');
    return;
  }
  let restore: ThreadRewindRestore = 'conversation';
  let sending = false;
  const files = opts.files ?? [];
  const wanted = new Set(files.map((file) => file.path));
  const error = h('p.wt-rewind-error.note.bad', { role: 'alert', hidden: true });
  const back = h('button.btn.ghost', { type: 'button', onclick: () => modal.close() }, 'Back');
  const confirm = h('button.btn.primary', { type: 'button' }, 'Rewind');
  const syncConfirm = () => {
    confirm.disabled = sending || (restore === 'choose' && !wanted.size);
  };
  const chooser = h(
    'div.wt-rewind-files',
    { role: 'group', 'aria-label': 'Restore Files to Rewind Point', hidden: true },
    ...files.map((file) => {
      const box = h('input', {
        type: 'checkbox',
        checked: true,
        onchange: () => {
          if (box.checked) wanted.add(file.path);
          else wanted.delete(file.path);
          syncConfirm();
        },
      });
      return h('label.wt-rewind-file', { title: file.path }, box, h('span.wt-rewind-path', {}, file.shortPath), h('small', {}, file.action === 'delete' ? 'delete' : 'restore'));
    }),
  );
  const choice = (value: ThreadRewindRestore, title: string, description: string, checked: boolean) => {
    const radio = h('input', {
      type: 'radio',
      name: 'wt-rewind-restore',
      value,
      checked,
      onchange: () => {
        restore = value;
        chooser.hidden = value !== 'choose';
        syncConfirm();
      },
    });
    return h('label.choice.wt-rewind-choice', {}, radio, h('span.choice-text', {}, h('b', {}, title), h('small', {}, description)));
  };
  const content = h(
    'div.modal.sm.wt-rewind',
    { role: 'dialog', 'aria-label': 'Rewind Conversation' },
    h('header', {}, h('div.titles', {}, h('h2', {}, 'Rewind Conversation'))),
    h(
      'div.body.stack',
      {},
      h('p', {}, 'Are you sure you want to rewind to this message?'),
      opts.text ? h('p.note', {}, opts.text.slice(0, 180)) : null,
      h(
        'div.choices.rows',
        { role: 'radiogroup', 'aria-label': 'Rewind File Restoration' },
        choice('conversation', "Don't restore files", 'Rewind the conversation only. Keep every file as it is now.', true),
        choice('files', 'Restore all files', 'Restore modified files and delete files created since this message.', false),
        files.length ? choice('choose', 'Choose files to restore...', `Pick which of the ${files.length === 1 ? 'file' : `${files.length} files`} changed since this message to restore.`, false) : null,
      ),
      chooser,
      error,
    ),
    h('footer', {}, h('span.grow'), back, confirm),
  );
  const modal = openModal(content, { escCloses: () => !sending, backdropCloses: false });
  const controls = [...content.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')];
  confirm.addEventListener('click', async () => {
    if (sending) return;
    sending = true;
    error.hidden = true;
    for (const control of controls) control.disabled = true;
    confirm.replaceChildren(h('span.spinner', { 'aria-hidden': 'true' }), 'Rewinding…');
    let why: string | undefined;
    try {
      why = await opts.send(restore, restore === 'choose' ? files.filter((file) => wanted.has(file.path)).map((file) => file.path) : undefined);
    } catch (err) {
      why = (err instanceof Error ? err.message : String(err)) || 'Failed to rewind conversation';
    }
    if (!why) {
      modal.close();
      return;
    }
    sending = false;
    error.textContent = why;
    error.hidden = false;
    for (const control of controls) control.disabled = false;
    confirm.replaceChildren('Rewind');
    syncConfirm();
  });
}

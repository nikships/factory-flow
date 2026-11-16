import { readRewindFiles, readRewindMenu, readRewindRestore, rewindFileFor, rewindProcessing, rewindWithoutFiles, rewound, type RewindMenu } from '../shared/thread-rewind.js';
import { textSignature } from '../shared/thread-live.js';

export interface RewindDriveTarget {
  /** Droid's menu number (JSONL seq + 1), so equal prompts stay distinguishable. */
  number: number;
  preview: string;
}

export interface RewindDriveResult {
  ok: boolean;
  error?: string;
  /** What the owner should know about a rewind that worked. */
  note?: string;
}

/** All files, none (conversation only), or just these paths from Droid's "Choose files to restore..." list. */
export type RewindRestore = 'files' | 'conversation' | { files: readonly string[] };

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const ESC = '\x1b';

function samePreview(shown: string, text: string): boolean {
  const a = textSignature(shown);
  const b = textSignature(text);
  return !!a && !!b && (b.startsWith(a) || a.startsWith(b));
}

const RESTORE_LABEL = { files: 'Restore all files', conversation: "Don't restore files", choose: 'Choose files to restore...' } as const;

/**
 * Drives Droid's own rewind menu, never editing its conversation files. The caller has already made
 * sure the worker is idle and resolved the user entry to its menu number and preview.
 */
export async function driveDroidRewind(io: { write(data: string): void; rows(): readonly string[] | undefined }, target: RewindDriveTarget, restore: RewindRestore): Promise<RewindDriveResult> {
  const rows = () => io.rows() ?? [];
  const fail = async (error: string): Promise<RewindDriveResult> => {
    io.write(ESC);
    await pause(60);
    io.write('\x15');
    return { ok: false, error };
  };
  const choice = typeof restore === 'string' ? restore : 'choose';
  const wantedFiles = typeof restore === 'string' ? [] : restore.files;

  // Ctrl+U clears a draft so the slash command cannot be appended to it.
  io.write('\x15');
  await pause(40);
  io.write('/rewind-conversation');
  await pause(80);
  io.write('\r');

  let menu: RewindMenu | undefined;
  for (let attempt = 0; attempt < 50 && !menu; attempt++) {
    await pause(40);
    menu = readRewindMenu(rows());
  }
  if (!menu) return fail('Droid did not open its rewind menu.');
  if (menu.empty) return fail('Droid has no previous user messages to rewind to.');

  // Selection starts on the newest message. Rows scroll as the selection moves, so match again
  // after every key rather than trusting the first two visible rows.
  let previous = '';
  const visited = new Set<number>();
  for (;;) {
    const current = rows();
    menu = readRewindMenu(current);
    if (!menu) return fail('Droid closed its rewind menu before a message was selected.');
    const index = menu.rows.findIndex((row) => row.number === target.number);
    const numbered = menu.rows[index];
    if (numbered && !samePreview(numbered.preview, target.preview)) return fail('The active conversation changed. Read the Thread again before rewinding.');
    const selected = menu.rows.findIndex((row) => row.selected);
    const currentNumber = menu.rows[selected]?.number;
    if (currentNumber === undefined || visited.has(currentNumber)) return fail('The requested message is not in Droid’s rewind menu.');
    visited.add(currentNumber);
    if (index >= 0) {
      if (selected === index) break;
      io.write(index > selected ? DOWN : UP);
    } else {
      io.write(target.number < currentNumber ? DOWN : UP);
    }
    await pause(55);
    const signature = rows().join('\n');
    if (signature === previous) return fail('The requested message is not in Droid’s rewind menu.');
    previous = signature;
  }
  io.write('\r');

  let restored = choice === 'conversation';
  let submitted = false;
  let dismissed = false;
  let chose = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await pause(50);
    const current = rows();
    if (readRewindMenu(current) || rewindProcessing(current)) continue;
    if (rewindWithoutFiles(current)) {
      if (wantedFiles.length) return fail('Droid found no file changes to restore for this message.');
      if (!dismissed) io.write(ESC);
      dismissed = true;
      continue;
    }
    const files = readRewindFiles(current);
    if (files) {
      if (chose) continue;
      const error = await chooseFiles(io, wantedFiles);
      if (error) return fail(error);
      chose = true;
      restored = true;
      continue;
    }
    const options = readRewindRestore(current);
    if (!options) {
      if (rewound(current)) {
        // Droid puts the rewound prompt back in its input; the client prefills its own composer.
        io.write('\x15');
        // Droid skips its restoration screens when it has no file changes for the message.
        return wantedFiles.length && !chose ? { ok: true, note: 'Droid had no file changes to restore at this message, so only the conversation was rewound.' } : { ok: true };
      }
      continue;
    }
    if (submitted) continue;
    const label = RESTORE_LABEL[choice];
    const wanted = options.findIndex((option) => option.label === label);
    const selected = options.findIndex((option) => option.selected);
    if (wanted < 0 || selected < 0) return fail('Droid did not offer the requested rewind restoration.');
    if (wanted === selected) {
      io.write('\r');
      if (choice !== 'choose') restored = true;
      submitted = true;
    } else io.write(wanted > selected ? DOWN : UP);
  }
  return fail(restored ? 'Droid did not finish rewinding its conversation.' : 'Droid did not finish restoring the rewind point.');
}

/**
 * On Droid's "Restore Files to Rewind Point" list: clears every check (N), then walks the list from its
 * first row leaving only the wanted files checked, and applies (R), or skips restoring (S) when none
 * is wanted. Every wanted file must be on the list.
 */
async function chooseFiles(io: { write(data: string): void; rows(): readonly string[] | undefined }, wanted: readonly string[]): Promise<string | undefined> {
  const rows = () => io.rows() ?? [];
  if (!wanted.length) {
    io.write('s');
    return undefined;
  }
  io.write('n');
  await pause(80);
  // A frame drawn mid-redraw can show no selected row yet.
  const selection = async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const list = readRewindFiles(rows());
      if (!list) return 'closed' as const;
      const at = list.rows.findIndex((r) => r.selected);
      if (at >= 0) return { list, at };
      await pause(40);
    }
    return undefined;
  };
  for (let step = 0; step < 400; step++) {
    const now = await selection();
    if (now === 'closed') return 'Droid closed its file list before the files were chosen.';
    if (!now) return 'Droid’s file list has no selected row.';
    if (now.at === 0 && (now.list.first ?? 1) === 1) break;
    io.write(UP);
    await pause(60);
  }
  const found = new Set<string>();
  const seen = new Set<string>();
  for (let step = 0; step < 400; step++) {
    const now = await selection();
    if (now === 'closed') return 'Droid closed its file list before the files were chosen.';
    if (!now) return 'Droid’s file list has no selected row.';
    const row = now.list.rows[now.at];
    const key = `${row.action}:${row.path}`;
    if (seen.has(key)) break;
    seen.add(key);
    const match = rewindFileFor(wanted, row.path);
    if (match) found.add(match);
    // Toggle a row whose check is wrong, including one N left checked.
    if (!!match !== row.checked) {
      io.write(' ');
      await pause(60);
    }
    if (now.list.total !== undefined && seen.size >= now.list.total) break;
    io.write(DOWN);
    await pause(60);
  }
  const missing = wanted.filter((path) => !found.has(path));
  if (missing.length) return `Droid can’t restore ${missing.join(', ')} at this message.`;
  io.write('r');
  return undefined;
}

// Droid 1.12's /rewind-conversation screens. Pure parsing, checked against a real capture in
// tests/thread-rewind.test.ts; the terminal driving lives in src/server/worker-rewind.ts.

import { extractThreadChanges } from './thread-diff.js';
import type { ThreadEntry } from './worker-thread.js';

export interface RewindMenuRow {
  /** Droid's message number (the JSONL seq + 1), newest first. */
  number: number;
  preview: string;
  selected: boolean;
}

export interface RewindMenu {
  rows: RewindMenuRow[];
  empty: boolean;
  total?: number;
}

export interface RewindRestoreOption {
  label: string;
  selected: boolean;
}

const cell = (line: string) => {
  const start = line.indexOf('│');
  const end = line.lastIndexOf('│');
  return start >= 0 && end > start ? line.slice(start + 1, end) : '';
};

/** The user-message picker, or undefined while another screen is showing. */
export function readRewindMenu(lines: readonly string[]): RewindMenu | undefined {
  if (!lines.some((line) => cell(line).includes('Select a user message to rewind before'))) return undefined;
  const rows: RewindMenuRow[] = [];
  let empty = false;
  let total: number | undefined;
  for (const line of lines) {
    const text = cell(line) || line;
    if (text.includes('No previous user messages available for rewind.')) empty = true;
    const row = /^\s*([> ])\s*(\d+)\s+(.+?)\s*$/.exec(text);
    if (row) rows.push({ number: Number(row[2]), preview: row[3], selected: row[1] === '>' });
    const showing = /Showing\s+\d+-\d+\s+of\s+(\d+)/.exec(text);
    if (showing) total = Number(showing[1]);
  }
  return { rows, empty, ...(total !== undefined ? { total } : {}) };
}

/** The file-restoration choices, in the order Droid shows them. */
export function readRewindRestore(lines: readonly string[]): RewindRestoreOption[] | undefined {
  if (!lines.some((line) => cell(line).includes('Rewind File Restoration'))) return undefined;
  const options: RewindRestoreOption[] = [];
  for (const line of lines) {
    const text = cell(line);
    const match = /^\s*([> ])\s*(Restore all files|Choose files to restore\.\.\.|Don't restore files)\s*$/.exec(text);
    if (match) options.push({ label: match[2], selected: match[1] === '>' });
  }
  // The title can draw a frame before its choices do.
  return options.length ? options : undefined;
}

/** A file Droid's "Choose files to restore..." screen lists: an edited one to restore, or a created one to delete. */
export interface RewindFileRow {
  /** As Droid shows it, relative to the session's folder. */
  path: string;
  action: 'restore' | 'delete';
  checked: boolean;
  selected: boolean;
}

export interface RewindFileList {
  rows: RewindFileRow[];
  /** "1-2 of 2": the rows shown and how many there are. */
  first?: number;
  last?: number;
  total?: number;
}

/** "Restore Files to Rewind Point", or undefined while another screen is showing. */
export function readRewindFiles(lines: readonly string[]): RewindFileList | undefined {
  if (!lines.some((line) => cell(line).includes('Restore Files to Rewind Point'))) return undefined;
  const rows: RewindFileRow[] = [];
  let range: Pick<RewindFileList, 'first' | 'last' | 'total'> = {};
  for (const line of lines) {
    const row = /^\s*([> ])\s*\[([ x])\]\s+(.+?)\s+(restore|delete)\s*$/.exec(cell(line));
    if (row) {
      // An edited file shows its size before the action: "a.txt (6 B) restore".
      const path = row[3].replace(/\s+\(\d[\d.,]*\s*[A-Za-z]*\)$/, '');
      rows.push({ path, action: row[4] as RewindFileRow['action'], checked: row[2] === 'x', selected: row[1] === '>' });
    }
    if (/Space\/Enter toggle/.test(line)) {
      const shown = /(\d+)-(\d+) of (\d+)\s*$/.exec(line);
      if (shown) range = { first: Number(shown[1]), last: Number(shown[2]), total: Number(shown[3]) };
    }
  }
  return { rows, ...range };
}

const slashes = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '');

/** Whether a file the Thread names (absolute, or relative to the worker's folder) is the one Droid's list shows. */
export function rewindFileMatches(requested: string, shown: string): boolean {
  const a = slashes(requested);
  const b = slashes(shown);
  return !!a && !!b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));
}

/** The requested file a row of Droid's list stands for: the same path first, then one ending in the other. */
export function rewindFileFor(requested: readonly string[], shown: string): string | undefined {
  return requested.find((path) => slashes(path) === slashes(shown)) ?? requested.find((path) => rewindFileMatches(path, shown));
}

/** A file the conversation changed after a user message: a rewind to before it restores or deletes it. */
export interface RewindFile {
  path: string;
  shortPath: string;
  action: 'restore' | 'delete';
}

/** The files changed after the user message `entryId`, as Droid's "Choose files to restore..." lists them. */
export function rewindFilesSince(entries: readonly ThreadEntry[], entryId: string): RewindFile[] {
  const at = entries.findIndex((entry) => entry.id === entryId);
  if (at < 0) return [];
  const files = new Map<string, RewindFile>();
  for (const entry of entries.slice(at + 1)) {
    if (entry.error) continue;
    for (const change of extractThreadChanges(entry) ?? []) {
      // A file created after the message is deleted by the rewind, however often it was edited later.
      const action = files.get(change.path)?.action ?? (change.kind === 'added' ? 'delete' : 'restore');
      files.set(change.path, { path: change.path, shortPath: change.shortPath, action });
    }
  }
  return [...files.values()];
}

/** Whether this rewind point has no files to restore and Esc continues conversation-only. */
export function rewindWithoutFiles(lines: readonly string[]): boolean {
  return lines.some((line) => cell(line).includes('No file changes found for this rewind point')) && lines.some((line) => /Press Esc to continue without restoration/.test(cell(line) || line));
}

export function rewound(lines: readonly string[]): boolean {
  return lines.some((line) => /●\s+Rewound conversation to before:/.test(line));
}

/** Droid's status while it forks and restores the selected rewind point. */
export function rewindProcessing(lines: readonly string[]): boolean {
  return lines.some((line) => line.includes('(Please wait)'));
}

import { effortName, modelOnScreen, readLiveScreen } from '../shared/thread-live.js';

export type DroidSetting = { setting: 'effort'; value: string } | { setting: 'model'; name: string; effort?: string };

export interface SettingIo {
  write(data: string): void;
  rows(): readonly string[] | undefined;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const ESC = '\x1b';
/** Droid 1.12's Tab on its input box cycles the model's reasoning efforts and none, at most eight steps. */
const TAB = '\t';
const TAB_TRIES = 9;

/** The input box's settings as its mode line shows them, or undefined while a dialog covers it. */
function current(io: SettingIo) {
  const screen = readLiveScreen(io.rows() ?? []);
  // A dialog drawn in a box of its own has no mode line above it.
  if (screen.spec === undefined || screen.side || !screen.model) return undefined;
  const model = modelOnScreen(screen.model);
  return { model: model.name, effort: model.effort };
}

const sameEffort = (shown: string | undefined, wanted: string) => {
  const label = effortName(wanted).toLowerCase();
  if (label === 'off') return shown === undefined;
  return shown?.toLowerCase() === label;
};

/** Whether the mode line already shows `want`. */
function holds(io: SettingIo, want: DroidSetting): boolean | undefined {
  const now = current(io);
  if (!now) return undefined;
  if (want.setting === 'effort') return sameEffort(now.effort, want.value);
  return now.model === want.name && (want.effort === undefined || sameEffort(now.effort, want.effort));
}

/**
 * Changes the session's model or reasoning effort the way the owner would in Droid's TUI: Tab until
 * the mode line shows the effort, and its /model picker for a model. Nothing is written to Droid's
 * settings files.
 */
export async function driveDroidSetting(io: SettingIo, want: DroidSetting): Promise<string | undefined> {
  const now = holds(io, want);
  if (now === undefined) return 'Droid has a dialog open. Close it in Raw TTY first.';
  if (now) return undefined;
  if (want.setting === 'model') return pickModel(io, want.name, want.effort);
  // Ctrl+U clears anything typed in the terminal, so a key like Tab is not taken as completion.
  io.write('\x15');
  await pause(40);
  for (let i = 0; i < TAB_TRIES; i++) {
    const before = (io.rows() ?? []).join('\n');
    io.write(TAB);
    for (let wait = 0; wait < 20 && (io.rows() ?? []).join('\n') === before; wait++) await pause(25);
    await pause(30);
    const done = holds(io, want);
    if (done === undefined) return 'Droid opened a dialog while the setting was changing. Check Raw TTY.';
    if (done) return undefined;
  }
  return `This model has no ${effortName(want.value)} reasoning effort.`;
}

const box = (line: string) => {
  const start = line.indexOf('│');
  const end = line.lastIndexOf('│');
  return start >= 0 && end > start ? line.slice(start + 1, end) : undefined;
};

/** The model rows /model lists under its filter, in order, by name (the current one carries its effort). */
function modelRows(lines: readonly string[]): string[] | undefined {
  const top = lines.findIndex((line) => box(line)?.includes('Select Model For This Session'));
  if (top < 0) return undefined;
  const out: string[] = [];
  // The filter is the first row after the Main | Spec tabs; the list follows it.
  const tabs = lines.findIndex((line, at) => at > top && /◉|○/.test(box(line) ?? ''));
  if (tabs < 0) return undefined;
  const filter = lines.findIndex((line, at) => at > tabs && !!box(line)?.trim());
  if (filter < 0) return undefined;
  for (let i = filter + 1; i < lines.length; i++) {
    const text = box(lines[i]);
    if (text === undefined) break;
    const row = text.trim();
    if (!row || /^──/.test(row) || /^Manage custom models$/.test(row)) continue;
    if (/^Multipliers represent/.test(row)) break;
    out.push(row.replace(/^[●○>›]\s*/, '').split(/\s{2,}/)[0]);
  }
  return out;
}

function effortRows(lines: readonly string[]): { label: string; selected: boolean }[] | undefined {
  if (!lines.some((line) => box(line)?.includes('Select Reasoning Effort'))) return undefined;
  const out: { label: string; selected: boolean }[] = [];
  for (const line of lines) {
    const m = /^\s*([> ])\s*([A-Z][A-Za-z ]+?)(?: \(current\))?\s*$/.exec(box(line) ?? '');
    if (m && m[2] !== 'Select Reasoning Effort') out.push({ label: m[2], selected: m[1] === '>' });
  }
  return out;
}

/** Droid's "This model is no longer the latest version" choices, under its box. */
function legacyRows(lines: readonly string[]): { label: string; selected: boolean }[] | undefined {
  if (!lines.some((line) => box(line)?.includes('This model is no longer the latest version'))) return undefined;
  const out: { label: string; selected: boolean }[] = [];
  for (const line of lines) {
    const m = /^\s*([> ])\s*(Switch to latest\b.*?|Keep using legacy)\s*$/.exec(line);
    if (m) out.push({ label: m[2], selected: m[1] === '>' });
  }
  return out;
}

const listed = (lines: readonly string[]) => {
  const found = modelRows(lines)?.filter(Boolean);
  return found?.length ? found : undefined;
};

async function waitFor<T>(io: SettingIo, read: (lines: readonly string[]) => T | undefined, tries = 50): Promise<T | undefined> {
  for (let i = 0; i < tries; i++) {
    const value = read(io.rows() ?? []);
    if (value !== undefined) return value;
    await pause(40);
  }
  return undefined;
}

/** Types the model's name into /model's filter, moves down to its row, picks it and its effort. */
async function pickModel(io: SettingIo, name: string, effort: string | undefined): Promise<string | undefined> {
  const fail = async (error: string) => {
    io.write(ESC);
    await pause(60);
    return error;
  };
  io.write('\x15');
  await pause(40);
  io.write('/model');
  await pause(80);
  io.write('\r');
  if (!(await waitFor(io, listed))) return fail('Droid did not open its model picker.');
  // Only the name's printable characters reach the filter, never a key like Enter or Esc.
  io.write([...name].filter((c) => c >= ' ' && c !== '\x7f').join(''));
  await pause(600);
  const rows = (await waitFor(io, listed, 25)) ?? [];
  const index = rows.findIndex((row) => row === name || row.startsWith(`${name} (`));
  if (index < 0) return fail(`Droid’s model picker has no ${name}.`);
  // Droid drops arrow keys that come faster than it redraws the list.
  for (let i = 0; i <= index; i++) {
    io.write(DOWN);
    await pause(300);
  }
  io.write('\r');
  // Enter is sent once per dialog; the next frames can still show it while it closes.
  let kept = false;
  let picked = false;
  for (let i = 0; i < 60; i++) {
    await pause(50);
    const legacy = legacyRows(io.rows() ?? []);
    if (legacy?.length) {
      if (kept) continue;
      // The owner picked this model by name, so keep it rather than take Droid's newer one.
      const keep = legacy.findIndex((row) => row.label === 'Keep using legacy');
      const selected = legacy.findIndex((row) => row.selected);
      if (keep < 0 || selected < 0) return fail(`Droid asked whether to keep ${name}. Answer it in Raw TTY.`);
      kept = keep === selected;
      io.write(kept ? '\r' : keep > selected ? DOWN : UP);
      await pause(150);
      continue;
    }
    const efforts = effortRows(io.rows() ?? []);
    if (efforts?.length) {
      if (picked) continue;
      const target = effort ? efforts.findIndex((row) => sameEffort(row.label, effort)) : efforts.findIndex((row) => row.selected);
      const selected = efforts.findIndex((row) => row.selected);
      if (target < 0) return fail(`${name} has no ${effortName(effort ?? '')} reasoning effort.`);
      picked = target === selected;
      io.write(picked ? '\r' : target > selected ? DOWN : UP);
      continue;
    }
    const now = current(io);
    if (now?.model === undefined) continue;
    if (now.model === name) return effort === undefined || sameEffort(now.effort, effort) ? undefined : `Droid switched to ${name} but kept ${now.effort ?? 'no'} reasoning effort.`;
    if (i > 20) return `Droid switched to ${now.model} instead of ${name}. Check Raw TTY.`;
  }
  return fail('Droid did not finish switching models. Check Raw TTY.');
}

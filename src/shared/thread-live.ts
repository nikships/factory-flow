// A worker's turn as it happens, for the Thread to show over the conversation's canonical rows. The
// conversation file holds every finished message; what it can't hold yet (the message being written,
// a command's output so far, the phase and its timers, the session's settings) comes from the
// worker's hooks, its terminal screen and its session settings file, gathered by the server
// (src/server/thread-live.ts) and pushed as `thread.live`. Pure ES2022: the server and both clients
// read the same shapes, and the screen readers here are checked against real Droid screens.

/** Factory's droidStatusIndicator states. */
export type ThreadLiveStatus = 'idle' | 'pondering' | 'responding' | 'waiting' | 'compacting';

/** Droid's daemon `DroidWorkingState`, as near as the terminal shows it. */
export type ThreadLiveWorking = 'idle' | 'thinking' | 'streaming_assistant_message' | 'waiting_for_tool_confirmation' | 'executing_tool' | 'compacting_conversation';

export interface ThreadLiveTool {
  /** The canonical entry (`tool:<tool_use_id>`), when the call is in the conversation file. */
  id?: string;
  name: string;
  startedAt: number;
  phase: 'running' | 'waiting_permission';
  /** A subagent's session running it, when it isn't the worker's own. */
  session?: string;
  /** Execute: the output its terminal shows so far. */
  output?: string;
  /** Lines the terminal says it left out. */
  more?: number;
}

export interface ThreadSessionSettings {
  model?: string;
  modelName?: string;
  reasoningEffort?: string;
  interactionMode?: string;
  autonomyLevel?: string;
  autonomyMode?: string;
}

export interface ThreadLiveStream {
  kind: 'thinking' | 'text';
  text: string;
  since: number;
}

/** Droid's side chat (/btw), while it is open in the terminal. */
export interface ThreadLiveSide {
  /** The question and answer as the side chat shows them so far. */
  text: string;
}

export interface ThreadLive {
  rev: number;
  at: number;
  status: ThreadLiveStatus;
  working: ThreadLiveWorking;
  label?: string;
  turnStartedAt?: number;
  phaseSince?: number;
  after?: string;
  stream?: ThreadLiveStream;
  tools: ThreadLiveTool[];
  waiting?: { kind: 'permission' | 'question' | 'spec' | 'other'; toolId?: string };
  settings?: ThreadSessionSettings;
  /** A rewind the office is driving in the terminal (worker.rewind), until it ends. */
  rewind?: { entryId: string; since: number };
  side?: ThreadLiveSide;
}

/** Factory's status for a working state (its uEc): an open question or permission wins. */
export function liveStatus(working: ThreadLiveWorking, waiting = false): ThreadLiveStatus {
  if (waiting || working === 'waiting_for_tool_confirmation') return 'waiting';
  if (working === 'streaming_assistant_message') return 'responding';
  if (working === 'compacting_conversation') return 'compacting';
  if (working === 'thinking' || working === 'executing_tool') return 'pondering';
  return 'idle';
}

// ── Reading Droid's terminal ───────────────────────────────────────────────────────────────────────
// Droid 1.12's TUI, as its rows read with wrapped rows joined back into lines (see the server's
// screenLines). An assistant message starts with "⛬" in the first column and goes on indented three
// columns; a thought is a "Thinking:" line and its text; a tool call is its name and arguments, then
// "↳" result lines. Under the conversation: a "Plan · n/m" list, the queue, the spinner line
// ("⠸ Streaming...  (Press ESC to stop)"), the mode and model line, the input box and the footer
// ("[⏱ 13s, context: 5%] ? for help").

const SPINNER = /^\s*[\u2800-\u28ff]\s+(.+?)\s*\(Press ESC to stop\)\s*$/;
// The input box's top border, titled "── Spec ──" in Spec mode.
const BOX_TOP = /^\s*╭─+(?: [^─]+ ─+)?╮\s*$/;
const SPEC_BOX = /^\s*╭─+ Spec ─+╮\s*$/;
const SIDE_TOP = /^\s*── Side chat ─+.*Esc close ──\s*$/;
const SIDE_INPUT = /^\s*› /;
// The input box's first row: its prompt, with or without a draft.
const INPUT_ROW = /^\s*│\s?[>›]/;
// A model as the mode line names it ("Haiku 5.5 (High)", "GPT-6.1 Sol", BYOK "DroidProxy: GPT 6.1 Sol (High)"), never a transcript line.
const MODEL_NAME = /^[\w.\-[\]: ]+(?: \([A-Za-z ]+\))?$/;
const PLAN = /^Plan · \d+\/\d+/;
const QUEUE_HEADING = /^\s*(?:Queued|Steering) messages:\s*$/;
const MESSAGE = /^⛬\s*/;
const THOUGHT = /^ {0,3}Thinking:\s*$/;
const RESULT = /^ {4}↳ ?/;
const MORE = /^ {4}\.\.\. (\d+) more, Ctrl\+O to view/;
const CONTINUED_ARGS = /^ {5,}&& /;
/** How far above the input box the spinner, plan and queue can reach. */
const CHROME_REACH = 60;

export interface LiveScreen {
  /** The spinner's words, e.g. "Thinking...", "Planning 8 actions". */
  label?: string;
  working?: ThreadLiveWorking;
  /** The model and effort on the mode line, e.g. "Haiku 5.5 (Low)". */
  model?: string;
  /** Whether the input box is in Spec mode. Undefined without an input box (a dialog is open). */
  spec?: boolean;
  side?: ThreadLiveSide;
  /** The conversation rows above the plan, queue and spinner. */
  transcript: string[];
}

/** What a spinner's words say Droid is doing. */
export function spinnerWorking(label: string): ThreadLiveWorking {
  if (/compact/i.test(label)) return 'compacting_conversation';
  if (/^Streaming/i.test(label)) return 'streaming_assistant_message';
  if (/^(Executing|Invoking tools|Running)/i.test(label)) return 'executing_tool';
  return 'thinking';
}

/** The side chat's question and answer, from its titled rule down to its input line. */
export function readSideChat(lines: readonly string[]): ThreadLiveSide | undefined {
  let top = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (SIDE_TOP.test(lines[i])) {
      top = i;
      break;
    }
  if (top < 0) return undefined;
  const input = lines.findIndex((line, at) => at > top && SIDE_INPUT.test(line));
  // A side chat that has closed leaves its rule in the scrollback but no input line under it.
  if (input < 0) return undefined;
  // The body is indented two columns past the rule.
  const indent = new RegExp(`^ {0,${(/^ */.exec(lines[top])?.[0].length ?? 0) + 2}}`);
  const body = lines.slice(top + 1, input).map((line) => line.replace(indent, '').trimEnd());
  return {
    text: body
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

export function readLiveScreen(lines: readonly string[]): LiveScreen {
  const side = readSideChat(lines);
  let box = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (BOX_TOP.test(lines[i])) {
      box = i;
      break;
    }
  if (box < 0) return { transcript: [...lines], ...(side ? { side } : {}) };
  let label: string | undefined;
  let chrome = box;
  // A dialog drawn in a box of its own (the model picker, a legacy-model warning) is not the input box.
  const input = INPUT_ROW.test(lines[box + 1] ?? '');
  // The mode line, with the model at its end or on a line of its own.
  let model: string | undefined;
  for (let i = box - 1; i >= Math.max(0, box - 2); i--) {
    const line = lines[i];
    if (!line.trim()) break;
    const parts = line.trim().split(/\s{2,}/);
    const last = parts.at(-1) ?? '';
    if (parts.length > 1 && MODEL_NAME.test(last)) model ??= last;
    else if (i === box - 1 && /\([A-Za-z ]+\)$/.test(line.trim()) && !/·/.test(line)) model ??= line.trim();
    else if (!/·/.test(line)) break;
    chrome = i;
  }
  for (let i = chrome - 1; i >= Math.max(0, box - CHROME_REACH); i--) {
    const line = lines[i];
    const spin = SPINNER.exec(line);
    if (spin && label === undefined) {
      label = spin[1].trim();
      chrome = i;
    } else if (PLAN.test(line) || QUEUE_HEADING.test(line)) chrome = i;
  }
  while (chrome > 0 && !lines[chrome - 1].trim()) chrome--;
  return {
    transcript: lines.slice(0, chrome),
    ...(label !== undefined ? { label, working: spinnerWorking(label) } : {}),
    ...(input && model ? { model } : {}),
    ...(input ? { spec: SPEC_BOX.test(lines[box]) } : {}),
    ...(side ? { side } : {}),
  };
}

/** A mode line's model ("Sonnet 5.5 (High)") split into its name and reasoning effort label. */
export function modelOnScreen(shown: string): { name: string; effort?: string } {
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(shown.trim());
  return m ? { name: m[1], effort: m[2] } : { name: shown.trim() };
}

const EFFORT_LABEL: Record<string, string> = { off: 'Off', none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

/** Droid's label for a `reasoningEffort` id, e.g. "Extra high" for "xhigh". */
export function effortName(effort: string): string {
  return EFFORT_LABEL[effort.toLowerCase()] ?? effort;
}

/** The `reasoningEffort` id for a label the mode line shows, e.g. "xhigh" for "Extra high"; never off, which it doesn't show. */
export function effortId(label: string): string | undefined {
  const wanted = label.trim().toLowerCase();
  return Object.keys(EFFORT_LABEL).find((id) => id !== 'off' && id !== 'none' && EFFORT_LABEL[id].toLowerCase() === wanted);
}

/** A tool call's first line: its name at the message's indent, its result lines under it. */
function toolHeader(lines: readonly string[], i: number): boolean {
  if (!/^ {3}[A-Z][\w.:-]*(?: |$)/.test(lines[i])) return false;
  for (let j = i + 1; j < lines.length && j <= i + 8; j++) {
    if (RESULT.test(lines[j])) return true;
    if (!CONTINUED_ARGS.test(lines[j])) return false;
  }
  return false;
}

const dedent = (line: string) => line.replace(/^ {1,3}/, '');

function paragraphs(lines: readonly string[]): string {
  return lines
    .map((line) => dedent(line).trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The last message or thought on the screen, as far as the terminal shows it. */
export function readScreenStream(transcript: readonly string[]): { kind: 'thinking' | 'text'; text: string } | undefined {
  let message = -1;
  let thought = -1;
  for (let i = transcript.length - 1; i >= 0 && (message < 0 || thought < 0); i--) {
    if (message < 0 && MESSAGE.test(transcript[i])) message = i;
    if (thought < 0 && THOUGHT.test(transcript[i])) thought = i;
  }
  const start = Math.max(message, thought);
  if (start < 0) return undefined;
  const body: string[] = [];
  if (start === message && start !== thought) body.push(transcript[start].replace(MESSAGE, ''));
  for (let i = start + 1; i < transcript.length; i++) {
    if (toolHeader(transcript, i) || MESSAGE.test(transcript[i]) || THOUGHT.test(transcript[i])) break;
    body.push(transcript[i]);
  }
  const text = paragraphs(body);
  if (!text) return undefined;
  return { kind: start === thought ? 'thinking' : 'text', text };
}

/** The output the terminal shows under the last call of `name` whose arguments `matches` accepts. */
export function readScreenToolOutput(transcript: readonly string[], name: string, matches: (args: string) => boolean = () => true): { output: string; more?: number } | undefined {
  const head = new RegExp(`^ {3}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (.*))?$`);
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = head.exec(transcript[i]);
    if (!m) continue;
    let j = i + 1;
    const args = [m[1] ?? ''];
    for (; j < transcript.length && CONTINUED_ARGS.test(transcript[j]); j++) args.push(transcript[j].trim());
    if (!matches(args.join(' '))) continue;
    const out: string[] = [];
    let more: number | undefined;
    for (; j < transcript.length; j++) {
      const line = transcript[j];
      const hidden = MORE.exec(line);
      if (hidden) {
        more = Number(hidden[1]);
        break;
      }
      if (RESULT.test(line)) out.push(line.replace(RESULT, ''));
      else if (out.length && /^ {6}/.test(line)) out.push(line.slice(6));
      else break;
    }
    if (!out.length) return undefined;
    return { output: out.join('\n'), ...(more !== undefined ? { more } : {}) };
  }
  return undefined;
}

/** Letters and digits only: how a terminal's rendering of Markdown is compared with its source. */
export function textSignature(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Whether a call's arguments as the terminal shows them (maybe cut with "...") begin the command it ran. */
export function sameCommand(shown: string, command: string): boolean {
  const a = shown.replace(/\.\.\.$/, '').replace(/\s+/g, '');
  const b = command.replace(/\s+/g, '');
  if (!a) return false;
  return b.startsWith(a.slice(0, 60)) || a.startsWith(b.slice(0, 60));
}

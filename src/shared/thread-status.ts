/**
 * The Thread's status row and timing copy, matching the Factory app's droidStatusIndicator and thinking
 * block. The phrase pools are Factory's own English strings: the row picks one at random, then a different
 * one every [STATUS_ROTATE_MS], fading each change over [STATUS_FADE_MS].
 */

import type { WorkerStatus } from './protocol.js';

export type ThreadStatusMode = 'idle' | 'pondering' | 'responding' | 'waiting' | 'compacting';

export const STATUS_ROTATE_MS = 10_000;
export const STATUS_FADE_MS = 400;

const STATUS_PONDERS: readonly string[] = [
  'Following a thread here...',
  "There's something interesting about this...",
  'Let me trace this through...',
  'Something caught my attention...',
  'Let me look a bit closer...',
  'I wonder if this connects...',
  'This reminds me of something...',
  'Let me pull on this thread...',
  'Something here is worth exploring...',
  'Let me dig into this a bit...',
  'Curious about this part...',
  'I want to understand this better...',
  "There's more here than I expected...",
  'Following my intuition here...',
  "Something's taking shape...",
  'The pieces are starting to fit...',
  'This is beginning to click...',
  'A picture is forming...',
  'Things are coming into focus...',
  'The fog is starting to lift...',
  'I can see the outline now...',
  "It's starting to make sense...",
  'Connections are forming...',
  'A path is appearing...',
  "I think I'm onto something...",
  "Something's crystallizing here...",
  'The shape is revealing itself...',
  'Pieces falling into place...',
  'Let me think through this...',
  'Considering a few angles here...',
  'Turning this over in my mind...',
  'Weighing the options...',
  'Let me sit with this a moment...',
  'Thinking through the implications...',
  'Let me reason through this...',
  'Taking a moment to consider...',
  'Giving this some thought...',
  'Let me work through this...',
  'Thinking about the best approach...',
  'Considering how to tackle this...',
  'Mulling this over...',
  'Tracing the logic here...',
  'Exploring the possibilities...',
  'Mapping out the terrain...',
  'Navigating through this...',
  'Scanning the landscape...',
  'Probing a bit deeper...',
  'Working through the layers...',
  'Diving into the details...',
  'Making my way through this...',
  'Feeling out the edges...',
  'Charting a course here...',
  'I think I see a pattern...',
  'Something looks familiar here...',
  "I've seen something like this...",
  "There's a rhythm to this...",
  'The structure is showing itself...',
  "I'm spotting connections...",
  "There's a theme emerging...",
  'Noticing the underlying shape...',
  'Finding the hidden order...',
  "What's the best angle here...",
  'There might be a simpler way...',
  'What am I missing...',
  'Let me try another approach...',
  "What's the heart of this...",
  'Let me break this down...',
  'Finding the key insight...',
  'Zeroing in on the core...',
  'Getting to the essence...',
  'What if I approach it this way...',
  "Or maybe it's simpler than that...",
  "Hmm, that's interesting...",
  'Wait, what about this...',
  'Let me reconsider...',
  "Although, there's also...",
  'Could it be that...',
  'What if instead...',
  'Then again...',
  "Something's percolating...",
  'The gears are turning...',
  'Mental wheels spinning...',
  "Something's brewing here...",
  'Thoughts simmering...',
  'Ideas taking form...',
  'Reticulating the splines...',
  'Threads beginning to converge...',
  'The mist is clearing...',
  'Form emerging from the noise...',
  'Signal getting stronger...',
  'Edges becoming clearer...',
  'Layers slowly unfolding...',
];

const STATUS_RESPONDS: readonly string[] = [
  'Gathering my thoughts...',
  'Finding the right words...',
  'Let me walk you through this...',
  "Here's what I'm thinking...",
  'Putting this together...',
  'Articulating the approach...',
  'Let me explain my thinking...',
  'Forming the response...',
  'Translating thoughts to words...',
  'Shaping the explanation...',
];

const STATUS_WAITS: readonly string[] = [
  'Waiting on your thoughts...',
  'Standing by for your input...',
  'Ready when you are...',
  'Take your time...',
  "No rush, I'll be here...",
  "Whenever you're ready...",
  'Paused and listening...',
  'Patient as always...',
  'In no hurry...',
  'Standing by...',
  'Holding steady...',
  'Here whenever...',
  'At your pace...',
  'Waiting patiently...',
  'Taking a breather...',
  'On pause for now...',
  "Curious what you'll decide...",
  "Wondering which way you'll go...",
  'Interested to see your choice...',
  'Awaiting your direction...',
  'Eager to hear your take...',
  'Curious about your thinking...',
  'Interested in your perspective...',
  "Wondering what you're thinking...",
  'Intrigued to see your call...',
  'Looking forward to your input...',
  'Anticipating your decision...',
  "Curious which path you'll take...",
  "This one's your call...",
  'Over to you on this...',
  'Your move...',
  "Ball's in your court...",
  'Need your input here...',
  'Your decision to make...',
  'Deferring to your judgment...',
  'This requires your touch...',
  "You're the expert here...",
  'Trusting your instincts...',
  'Leaving this in your hands...',
  'Your expertise needed...',
  'Could use your guidance...',
  'Handing the reins to you...',
  "This one's all yours...",
  'Happy to wait...',
  'Here if you need more context...',
  'Let me know if I can clarify...',
  'Just say the word...',
  'Happy to elaborate if needed...',
  'Ask me anything...',
  "Here to help if you're stuck...",
  'Feel free to think it over...',
  'No pressure at all...',
  'Take all the time you need...',
  'I can explain more if helpful...',
  'Here for questions...',
  'Listening...',
  'All ears...',
  'Attentively waiting...',
  'Focused on you...',
  'Tuned in...',
  'Fully present...',
  'Giving you space to think...',
  'Quietly standing by...',
  'Twiddling my virtual thumbs...',
  'Patiently humming to myself...',
  'Enjoying the pause...',
  'A moment of zen...',
  'Brief intermission...',
  'Comfortable silence...',
  'The ball is airborne...',
  'Awaiting transmission...',
  'Respecting your process...',
  'Your thought process at work...',
  'Giving you room to decide...',
  'Space for consideration...',
  'Room to deliberate...',
  'Time to weigh options...',
];

const STATUS_COMPACTING = 'Compacting conversation…';

export const STATUS_TOOLTIP = 'Droid picked these phrases to entertain you while it works.';

/**
 * The status row's mode: the live layer's when the office sends one, else what the worker's status says
 * (a turn running is pondering, a question or permission is waiting).
 */
export function statusMode(live: string | undefined, status: WorkerStatus | undefined): ThreadStatusMode {
  if (status === 'needs_input') return 'waiting';
  if (live === 'pondering' || live === 'responding' || live === 'waiting' || live === 'compacting') return live;
  return status === 'working' || status === 'starting' ? 'pondering' : 'idle';
}

export function statusPhrases(mode: ThreadStatusMode): readonly string[] {
  if (mode === 'pondering') return STATUS_PONDERS;
  if (mode === 'responding') return STATUS_RESPONDS;
  if (mode === 'waiting') return STATUS_WAITS;
  if (mode === 'compacting') return [STATUS_COMPACTING];
  return [];
}

/** A random index into a pool of [size], other than [previous] when there is a choice. */
export function pickPhrase(size: number, previous: number, random: () => number = Math.random): number {
  if (size <= 1) return 0;
  const excluding = previous >= 0 && previous < size;
  const next = Math.floor(random() * (excluding ? size - 1 : size));
  return excluding && next >= previous ? next + 1 : next;
}

/** "12s": whole seconds, at least 1, as Factory's thinking block counts them. */
export function thinkingSeconds(ms: number): string {
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

/** "Thought for 25s", or "Thought" when the time isn't known. */
export function thoughtLabel(ms: number | undefined): string {
  return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? `Thought for ${thinkingSeconds(ms)}` : 'Thought';
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];
let narrow: Intl.RelativeTimeFormat | undefined;

/** "22h ago", "5m ago", "now": Factory's narrow relative time under a message, at minute resolution. */
export function relativeTime(at: number, now: number): string {
  narrow ??= new Intl.RelativeTimeFormat('en', { style: 'narrow', numeric: 'always' });
  const delta = at - now;
  for (const [unit, size] of UNITS) if (Math.abs(delta) >= size) return narrow.format(Math.trunc(delta / size), unit);
  return 'now';
}

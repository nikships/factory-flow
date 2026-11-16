// The conversation as Droid's /copy and prompt history see it: each user prompt and the replies to it.
// Pure ES2022, shared by the web Thread; the Android Thread mirrors it in core/ThreadTurns.kt.
import type { ThreadEntry } from './worker-thread.js';

export interface ThreadTurn {
  prompt: string;
  replies: string[];
}

/** Each user prompt and the assistant's text replies until the next one. Replies before any prompt form a turn of their own. */
export function threadTurns(entries: readonly ThreadEntry[]): ThreadTurn[] {
  const turns: ThreadTurn[] = [];
  for (const entry of entries) {
    const text = entry.kind === 'text' ? entry.text?.trim() : '';
    if (!text) continue;
    if (entry.role === 'user') turns.push({ prompt: text, replies: [] });
    else if (entry.role === 'assistant') {
      if (!turns.length) turns.push({ prompt: '', replies: [] });
      turns[turns.length - 1].replies.push(text);
    }
  }
  return turns;
}

/** The prompts sent in this conversation, newest first, each once: what Up recalls in the composer. */
export function threadPrompts(entries: readonly ThreadEntry[], max = 50): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < max; i--) {
    const entry = entries[i];
    const text = entry.role === 'user' && entry.kind === 'text' ? entry.text?.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** Droid's /copy choices. */
export type ThreadCopyChoice = 'reply' | 'prompt' | 'session' | 'transcript' | 'turns';

const turnText = (turn: ThreadTurn) => [turn.prompt ? `User: ${turn.prompt}` : '', ...turn.replies.map((reply) => `Droid: ${reply}`)].filter(Boolean).join('\n\n');

/**
 * The text a /copy choice copies, or undefined when there is nothing to copy: the last reply or prompt,
 * the session id, the whole conversation, or its last `turns` turns.
 */
export function threadCopyText(entries: readonly ThreadEntry[], choice: ThreadCopyChoice, opts: { sessionId?: string; turns?: number } = {}): string | undefined {
  if (choice === 'session') return opts.sessionId || undefined;
  const turns = threadTurns(entries);
  const newest = [...turns].reverse();
  if (choice === 'reply') return newest.find((turn) => turn.replies.length)?.replies.join('\n\n');
  if (choice === 'prompt') return newest.find((turn) => turn.prompt)?.prompt;
  const count = choice === 'turns' ? Math.max(1, Math.floor(opts.turns ?? 1)) : turns.length;
  const picked = turns.slice(-count);
  return picked.length ? picked.map(turnText).join('\n\n') : undefined;
}

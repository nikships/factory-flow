/** A picture in the session (a tool's result or an attachment), served by `/api/thread/image` by its id. */
export interface ThreadImage {
  id: string;
  type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Its size in pixels, when its header says, so a client can make room before it loads. */
  width?: number;
  height?: number;
}

/** A safe, display-only projection of a local Droid conversation. */
export interface ThreadEntry {
  id: string;
  /** Unique increasing display position; tool results update their original call's position. */
  seq: number;
  role: 'user' | 'assistant' | 'system';
  kind: 'text' | 'tool' | 'thinking' | 'notice' | 'todo';
  text?: string;
  name?: string;
  input?: string;
  output?: string;
  error?: boolean;
  /** For a tool result, the seq the next entry took when the result was read: later than seq + 1 when other entries came first. */
  resultSeq?: number;
  /** Pictures in a tool's result or a message; `output` and `text` still say `[Image attachment]` for each. */
  images?: ThreadImage[];
  /** When its record was written (epoch ms). */
  at?: number;
  /** A tool's: when its result was written. */
  doneAt?: number;
  /** A thought's: how long the model took on the message it came in, from the record before it. */
  tookMs?: number;
  /** A Task call's: the session of the subagent it started (`thread.read` with `child`). */
  child?: string;
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The file on the office's machine a Markdown image in a reply names (`/Users/me/shot.png`,
 * `~/Pictures/a.png`, `docs/chart.svg` or `file:///tmp/a.png`), for the Thread to load through
 * `/api/thread/file?raw=image`; undefined for web, data and other URLs the client loads itself.
 */
export function localImagePath(src: string): string | undefined {
  let s = src.trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim();
  const file = /^file:\/\/(?:localhost)?(?=\/)/i.exec(s);
  if (file) s = s.slice(file[0].length);
  else if (URL_SCHEME.test(s) || s.startsWith('//') || s.startsWith('#') || s.startsWith('?')) return undefined;
  if (/%[0-9a-f]{2}/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      return undefined;
    }
  }
  return s && !s.includes('\0') ? s : undefined;
}

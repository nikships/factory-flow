// Pure ES2022 shared contract for Google Gemini Decision 1 (`gemini-decision-1`) and the inter-agent wake filter.

export const GEMINI_DECISIONS_MODEL = 'gemini-decision-1';
export const GEMINI_AI_STUDIO_KEYS_URL = 'https://aistudio.google.com/apikey';

/** How the inter-agent noise gate routes one message to a lead (docs/office-mcp.md#inter-agent-noise-gate). */
export type WakeTraffic = 'wake_immediately' | 'hold_for_batch' | 'record_silently' | 'block_and_coach';
export const WAKE_TRAFFIC: readonly WakeTraffic[] = ['wake_immediately', 'hold_for_batch', 'record_silently', 'block_and_coach'];

export function isWakeTraffic(value: unknown): value is WakeTraffic {
  return (WAKE_TRAFFIC as readonly unknown[]).includes(value);
}

/** Live noise gate counters since the office started. */
export interface WakeFilterTelemetry {
  /** Messages the gate routed (deterministic guardrails included; bypassed and failed-open calls are not). */
  evaluated: number;
  woken: number;
  held: number;
  silent: number;
  blocked: number;
  /** Mid-turn sibling notices a team_note skipped because the note did not concern that sibling. */
  siblingFiltered: number;
  /** Calls that failed or timed out and delivered as before. */
  failedOpen: number;
  /** Input tokens the noise gate spent. */
  inputTokens: number;
  lastLatencyMs?: number;
  lastAt?: number;
}

export function emptyWakeFilterTelemetry(): WakeFilterTelemetry {
  return { evaluated: 0, woken: 0, held: 0, silent: 0, blocked: 0, siblingFiltered: 0, failedOpen: 0, inputTokens: 0 };
}

export interface GeminiConnectionState {
  connected: boolean;
  /** Whether the inter-agent noise gate and smart lead wakeup filter routes team traffic. */
  wakeFilterOn: boolean;
  wakeFilter: WakeFilterTelemetry;
  fingerprint?: string;
  at?: number;
  checkedAt?: number;
  checking?: boolean;
  rejected?: string;
  calls: number;
  inputTokens: number;
  lastLatencyMs?: number;
  lastError?: string;
}

export function emptyGeminiState(): GeminiConnectionState {
  return {
    connected: false,
    wakeFilterOn: true,
    wakeFilter: emptyWakeFilterTelemetry(),
    calls: 0,
    inputTokens: 0,
  };
}

/** Basic format check for a user-supplied Gemini API key (no whitespace or control chars, reasonable length). */
export function isValidGeminiApiKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 16 && trimmed.length <= 512 && !/[\s\p{Cc}\p{Cf}]/u.test(trimmed);
}

/** Safe display fingerprint (e.g. `AIza…x9Qp`) without exposing the secret key. */
export function fingerprintGeminiKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return '••••';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

import { emptyWakeFilterTelemetry, isValidGeminiApiKey, type GeminiConnectionState, type WakeFilterTelemetry } from '../shared/gemini-vibes.js';
import type { ServerMsg } from '../shared/protocol.js';
import { AIRGAPPED_REASON } from '../shared/setup.js';
import { type FetchLike, type GeminiDecisionsStore, probeGeminiKey } from './gemini-decisions.js';

interface GeminiOptions {
  store: GeminiDecisionsStore;
  airgapped(): boolean;
  broadcastGemini(state: GeminiConnectionState): void;
  wakeTelemetry?(): WakeFilterTelemetry;
  fetchImpl?: FetchLike;
  now?: () => number;
}

/** Connection management for the lead wake filter, independent of any scene or viewer. */
export class GeminiConnection {
  private probeAbort?: AbortController;
  private checking = false;
  private calls = 0;
  private inputTokens = 0;
  private lastLatencyMs?: number;
  private lastError?: string;

  constructor(private readonly opts: GeminiOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  geminiState(): GeminiConnectionState {
    const store = this.opts.store;
    return {
      connected: store.connected(),
      wakeFilterOn: store.wakeFilterOn(),
      wakeFilter: this.opts.wakeTelemetry?.() ?? emptyWakeFilterTelemetry(),
      fingerprint: store.fingerprint(),
      at: store.at(),
      checkedAt: store.checkedAt(),
      checking: this.checking,
      rejected: store.rejected(),
      calls: this.calls,
      inputTokens: this.inputTokens,
      lastLatencyMs: this.lastLatencyMs,
      lastError: this.lastError,
    };
  }

  async connect(rawKey: string, by: string, reply: (msg: Extract<ServerMsg, { t: 'gemini.setup' }>) => void): Promise<void> {
    if (this.opts.airgapped()) {
      reply({ t: 'gemini.setup', ok: false, error: AIRGAPPED_REASON });
      return;
    }
    const key = rawKey.trim();
    if (!key) {
      reply({ t: 'gemini.setup', ok: false, error: 'Enter a Gemini API key.' });
      return;
    }
    if (!isValidGeminiApiKey(key)) {
      reply({ t: 'gemini.setup', ok: false, error: 'Enter a valid Google AI Studio key (starts with AIza).' });
      return;
    }
    this.probeAbort?.abort();
    const abort = new AbortController();
    this.probeAbort = abort;
    this.checking = true;
    this.opts.broadcastGemini(this.geminiState());

    const probe = await probeGeminiKey(key, {
      fetchImpl: this.opts.fetchImpl,
      signal: abort.signal,
      now: this.opts.now,
    });
    if (this.probeAbort !== abort) {
      reply({ t: 'gemini.setup', ok: false, error: 'Cancelled.' });
      return;
    }
    this.probeAbort = undefined;
    this.checking = false;

    if (!probe.ok) {
      this.opts.broadcastGemini(this.geminiState());
      reply({ t: 'gemini.setup', ok: false, error: probe.error });
      return;
    }

    const saveErr = this.opts.store.saveKey(key, by, this.now());
    if (saveErr) {
      this.opts.broadcastGemini(this.geminiState());
      reply({ t: 'gemini.setup', ok: false, error: saveErr });
      return;
    }

    // A response from the previous key must never reject or overwrite the newly verified key.
    this.calls += 1;
    this.inputTokens += probe.inputTokens;
    this.lastLatencyMs = probe.latencyMs;
    this.lastError = undefined;
    this.opts.broadcastGemini(this.geminiState());
    reply({ t: 'gemini.setup', ok: true, latencyMs: probe.latencyMs });
  }

  /** Re-verifies the stored Gemini API key ("Check again"). */
  async check(reply: (msg: Extract<ServerMsg, { t: 'gemini.setup' }>) => void): Promise<void> {
    if (this.opts.airgapped()) {
      reply({ t: 'gemini.setup', ok: false, error: AIRGAPPED_REASON });
      return;
    }
    const key = this.opts.store.apiKey();
    if (!key) {
      reply({ t: 'gemini.setup', ok: false, error: 'No Gemini API key is connected.' });
      return;
    }
    this.probeAbort?.abort();
    const abort = new AbortController();
    this.probeAbort = abort;
    this.checking = true;
    this.opts.broadcastGemini(this.geminiState());

    const probe = await probeGeminiKey(key, {
      fetchImpl: this.opts.fetchImpl,
      signal: abort.signal,
      now: this.opts.now,
    });
    if (this.probeAbort !== abort) {
      reply({ t: 'gemini.setup', ok: false, error: 'Cancelled.' });
      return;
    }
    this.probeAbort = undefined;
    this.checking = false;

    if (!probe.ok) {
      this.opts.store.markChecked(this.now(), probe.keyRejected ? probe.error : this.opts.store.rejected());
      this.lastError = probe.error;
      this.opts.broadcastGemini(this.geminiState());
      reply({ t: 'gemini.setup', ok: false, error: probe.error });
      return;
    }

    this.opts.store.markChecked(this.now(), undefined);
    this.calls += 1;
    this.inputTokens += probe.inputTokens;
    this.lastLatencyMs = probe.latencyMs;
    this.lastError = undefined;
    this.opts.broadcastGemini(this.geminiState());
    reply({ t: 'gemini.setup', ok: true, latencyMs: probe.latencyMs });
  }

  disconnect(): string | undefined {
    this.probeAbort?.abort();
    this.probeAbort = undefined;
    this.checking = false;
    const err = this.opts.store.disconnect();
    if (err) return err;
    this.lastError = undefined;
    this.opts.broadcastGemini(this.geminiState());
    return undefined;
  }

  setWakeFilterOn(on: boolean): string | undefined {
    const err = this.opts.store.setWakeFilterOn(on);
    if (err) return err;
    this.opts.broadcastGemini(this.geminiState());
    return undefined;
  }

  stop(): void {
    this.probeAbort?.abort();
    this.probeAbort = undefined;
    this.checking = false;
  }
}

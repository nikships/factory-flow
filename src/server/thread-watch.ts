import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { ORCHESTRATOR_ID } from '../shared/mission-control.js';
import type { ServerMsg } from '../shared/protocol.js';
import type { ThreadPage, ThreadSession, WorkerThreadReader } from './worker-thread.js';

export type ThreadPushMsg = Extract<ServerMsg, { t: 'thread.snapshot' }>;
export type ThreadLivePushMsg = Extract<ServerMsg, { t: 'thread.live' }>;
export type ThreadWatchMsg = ThreadPushMsg | ThreadLivePushMsg;

const watchKey = (workerId: string, child?: string) => (child ? `${workerId}\0${child}` : workerId);

export interface WatchedThreadTarget {
  kind: 'local' | 'cloud';
  floorId: string | null;
  busy: boolean;
  local?: ThreadSession;
}

export interface ThreadWatchOptions {
  workerThreads: Pick<WorkerThreadReader, 'read' | 'sessionPaths' | 'sessionPathsSync' | 'childSession'>;
  resolveWorker(workerId: string): WatchedThreadTarget | undefined;
  readCloud?(workerId: string): Promise<ThreadPage> | undefined;
  send(clientId: string, msg: ThreadWatchMsg): void;
  /** The local worker's live state over the entries just read; the tracker revs only real changes. */
  live?(workerId: string, entries: ThreadPushMsg['entries'], session?: ThreadSession): Promise<ThreadLivePushMsg['live'] | undefined>;
  localCoalesceMs?: number;
  cloudCoalesceMs?: number;
  maxWatchesPerClient?: number;
}

interface WorkerWatch {
  workerId: string;
  child?: string;
  clients: Set<string>;
  kind?: 'local' | 'cloud';
  sessionKey?: string;
  targetFileName?: string;
  filePath?: string;
  fileWatcher?: FSWatcher;
  dirPath?: string;
  dirWatcher?: FSWatcher;
  timer?: NodeJS.Timeout;
  /** Re-reads while the session file is missing; see pollMissing. */
  missingTimer?: NodeJS.Timeout;
  missingDelay?: number;
  reading: boolean;
  again: boolean;
  closed: boolean;
  lastDigest?: string;
  liveRevs: Map<string, number>;
}

const MISSING_POLL_MIN_MS = 250;
const MISSING_POLL_MAX_MS = 5000;

function sessionKeyOf(target: WatchedThreadTarget): string {
  if (target.kind === 'cloud') return 'cloud';
  const s = target.local;
  if (!s) return 'local:none';
  return `local:${s.sessionId}\0${s.cwd}\0${s.since ?? 0}\0${s.transcript ?? ''}`;
}

export function threadPageDigest(page: ThreadPage, busy: boolean): string {
  const parts = [page.sessionId ?? '', busy ? '1' : '0', page.hasMore ? '1' : '0', page.error ?? '', String(page.entries.length)];
  for (const e of page.entries) {
    const tail = (e.output ?? e.text ?? '').slice(-24);
    parts.push(
      `${e.id}:${e.seq}:${e.text?.length ?? -1}:${e.input?.length ?? -1}:${e.output?.length ?? -1}:${e.error ? 1 : 0}:${e.resultSeq ?? -1}:${e.images?.length ?? 0}:${e.at ?? -1}:${e.doneAt ?? -1}:${e.tookMs ?? -1}:${e.child ?? ''}:${tail}`,
    );
  }
  return parts.join('|');
}

export class ThreadWatchHub {
  private byWorker = new Map<string, WorkerWatch>();
  private byClient = new Map<string, Set<string>>();
  private readonly localCoalesceMs: number;
  private readonly cloudCoalesceMs: number;
  private readonly maxPerClient: number;
  private stopped = false;

  constructor(private readonly opts: ThreadWatchOptions) {
    this.localCoalesceMs = opts.localCoalesceMs ?? 60;
    this.cloudCoalesceMs = opts.cloudCoalesceMs ?? 50;
    this.maxPerClient = opts.maxWatchesPerClient ?? 16;
  }

  watch(clientId: string, workerId: string, on: boolean, child?: string): boolean {
    if (this.stopped || !clientId || !workerId) return false;
    const key = watchKey(workerId, child);
    if (!on) {
      this.removeSubscription(clientId, key);
      return true;
    }
    const target = this.opts.resolveWorker(workerId);
    if (!target) {
      this.removeSubscription(clientId, workerId);
      return false;
    }

    let clientSet = this.byClient.get(clientId);
    if (!clientSet) {
      clientSet = new Set();
      this.byClient.set(clientId, clientSet);
    }
    clientSet.delete(key);
    while (clientSet.size >= this.maxPerClient) {
      const oldest = clientSet.values().next().value;
      if (!oldest) break;
      this.removeSubscription(clientId, oldest);
    }
    clientSet.add(key);

    let entry = this.byWorker.get(key);
    if (!entry) {
      entry = {
        workerId,
        ...(child ? { child } : {}),
        clients: new Set(),
        liveRevs: new Map(),
        reading: false,
        again: false,
        closed: false,
      };
      this.byWorker.set(key, entry);
    }
    entry.clients.add(clientId);
    if (!child) this.refreshBinding(entry, target, false);
    // Settings arrive here too, while the worker is idle, not only after its first change.
    this.schedule(entry, 0);
    return true;
  }

  /** Records the latest hydrated page from `thread.read` when `clientId` is the sole watcher, so an unchanged wake never pushes a duplicate snapshot without starving other watching clients. */
  seed(workerId: string, page: ThreadPage, busy: boolean, child?: string, clientId?: string): void {
    const entry = this.byWorker.get(watchKey(workerId, child));
    if (!entry || entry.closed || page.error) return;
    if (entry.clients.size > 1 || (clientId && !entry.clients.has(clientId))) return;
    entry.lastDigest ??= threadPageDigest(page, busy);
  }

  /** Wakes watchers on worker status/turn/session transitions or CloudStream deltas. */
  notifyWorker(workerId: string): void {
    if (this.stopped) return;
    const target = this.opts.resolveWorker(workerId);
    if (!target) {
      this.unwatchWorker(workerId);
      return;
    }
    for (const entry of this.byWorker.values()) {
      if (entry.workerId !== workerId || entry.closed || !entry.clients.size) continue;
      if (!entry.child) this.refreshBinding(entry, target, true);
      this.schedule(entry, target.kind === 'cloud' ? this.cloudCoalesceMs : this.localCoalesceMs);
    }
  }

  /** A terminal repaint can change the streaming message or a running command's output alone. */
  screenChanged(workerId: string): void {
    if (this.stopped) return;
    for (const entry of this.byWorker.values()) {
      if (entry.workerId === workerId && !entry.child && entry.clients.size) this.schedule(entry, Math.max(100, this.localCoalesceMs));
    }
  }

  unwatchClient(clientId: string, keepOrchestrator = false): void {
    const set = this.byClient.get(clientId);
    if (!set) return;
    for (const key of [...set]) {
      if (keepOrchestrator && key === ORCHESTRATOR_ID) continue;
      this.removeSubscription(clientId, key);
    }
  }

  unwatchWorker(workerId: string): void {
    for (const [key, entry] of [...this.byWorker]) {
      if (entry.workerId !== workerId) continue;
      for (const clientId of [...entry.clients]) this.removeSubscription(clientId, key);
      if (this.byWorker.get(key) === entry) {
        this.teardown(entry);
        this.byWorker.delete(key);
      }
    }
  }

  watchedCount(clientId?: string): number {
    if (clientId !== undefined) return this.byClient.get(clientId)?.size ?? 0;
    return this.byWorker.size;
  }

  close(): void {
    this.stopped = true;
    for (const entry of this.byWorker.values()) this.teardown(entry);
    this.byWorker.clear();
    this.byClient.clear();
  }

  private removeSubscription(clientId: string, key: string): void {
    const set = this.byClient.get(clientId);
    if (set) {
      set.delete(key);
      if (!set.size) this.byClient.delete(clientId);
    }
    const entry = this.byWorker.get(key);
    if (!entry) return;
    entry.clients.delete(clientId);
    entry.liveRevs.delete(clientId);
    if (!entry.clients.size) {
      this.teardown(entry);
      this.byWorker.delete(key);
    }
  }

  /** A child watch reads the subagent beside the worker's session, never an arbitrary session id. */
  private async targetFor(entry: WorkerWatch): Promise<WatchedThreadTarget | undefined> {
    const target = this.opts.resolveWorker(entry.workerId);
    if (!target || !entry.child || target.kind !== 'local' || !target.local) return target;
    const child = await this.opts.workerThreads.childSession(target.local, entry.child);
    return { ...target, local: child };
  }

  private refreshBinding(entry: WorkerWatch, target: WatchedThreadTarget, wakeOnRebind: boolean): void {
    const key = sessionKeyOf(target);
    const changedSession = entry.sessionKey !== undefined && entry.sessionKey !== key;
    if (changedSession) {
      this.closeWatchers(entry);
      entry.lastDigest = undefined;
    }
    entry.kind = target.kind;
    entry.sessionKey = key;

    if (target.kind !== 'local' || !target.local) {
      this.closeWatchers(entry);
      return;
    }

    entry.targetFileName = `${target.local.sessionId}.jsonl`;
    const syncPaths = this.opts.workerThreads.sessionPathsSync(target.local);
    if (syncPaths) this.applyPaths(entry, syncPaths);

    const expectedKey = key;
    void this.opts.workerThreads.sessionPaths(target.local).then((resolved) => {
      if (entry.closed || !entry.clients.size || entry.sessionKey !== expectedKey || !resolved) return;
      const hadFile = entry.filePath !== undefined;
      const rebound = this.applyPaths(entry, resolved);
      // A file first bound here may already hold lines its watcher never saw, so read it once.
      if (rebound && (wakeOnRebind || (!hadFile && entry.filePath))) this.schedule(entry, this.localCoalesceMs);
    });
  }

  private applyPaths(entry: WorkerWatch, paths: { file?: string; dir: string; root: string }): boolean {
    let changed = false;
    const wantDir = [paths.dir, paths.root, path.dirname(paths.root)].find((p) => existsSync(p));
    if (entry.dirPath !== wantDir) {
      this.closeDirWatcher(entry);
      if (wantDir) {
        try {
          const w = fsWatch(wantDir, (_event, filename) => {
            if (entry.closed) return;
            const name = typeof filename === 'string' ? filename : undefined;
            if (wantDir === paths.dir && name && entry.targetFileName && name !== entry.targetFileName) return;
            this.schedule(entry, this.localCoalesceMs);
          });
          w.on('error', () => {
            this.closeDirWatcher(entry);
            this.schedule(entry, this.localCoalesceMs);
          });
          w.unref?.();
          entry.dirWatcher = w;
          entry.dirPath = wantDir;
          changed = true;
        } catch {
          // Directory disappeared mid-bind; next notification or parent wake retries.
        }
      }
    }

    const wantFile = paths.file && existsSync(paths.file) ? paths.file : undefined;
    if (entry.filePath !== wantFile) {
      this.closeFileWatcher(entry);
      if (wantFile) {
        try {
          const w = fsWatch(wantFile, (event) => {
            if (entry.closed) return;
            if (event === 'rename') this.closeFileWatcher(entry);
            this.schedule(entry, this.localCoalesceMs);
          });
          w.on('error', () => {
            this.closeFileWatcher(entry);
            this.schedule(entry, this.localCoalesceMs);
          });
          w.unref?.();
          entry.fileWatcher = w;
          entry.filePath = wantFile;
          changed = true;
        } catch {
          // File disappeared mid-bind; directory watcher will catch recreation.
        }
      }
    }

    if (entry.filePath) this.clearMissing(entry);
    else this.pollMissing(entry);
    return changed;
  }

  /**
   * macOS delivers directory events through FSEvents, whose stream starts asynchronously and can drop a
   * folder or file created right after the watcher binds. Until the session file exists, re-read on a
   * backing-off timer so a new session still shows up without a later wake.
   */
  private pollMissing(entry: WorkerWatch): void {
    if (entry.missingTimer || entry.closed || this.stopped) return;
    const delay = Math.min((entry.missingDelay ?? MISSING_POLL_MIN_MS / 2) * 2, MISSING_POLL_MAX_MS);
    entry.missingDelay = delay;
    entry.missingTimer = setTimeout(() => {
      entry.missingTimer = undefined;
      this.schedule(entry, 0);
    }, delay);
    entry.missingTimer.unref?.();
  }

  private clearMissing(entry: WorkerWatch): void {
    if (entry.missingTimer) clearTimeout(entry.missingTimer);
    entry.missingTimer = undefined;
    entry.missingDelay = undefined;
  }

  private schedule(entry: WorkerWatch, delayMs: number): void {
    if (this.stopped || entry.closed || !entry.clients.size) return;
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.flush(entry);
    }, delayMs);
    entry.timer.unref?.();
  }

  private async flush(entry: WorkerWatch): Promise<void> {
    if (this.stopped || entry.closed || !entry.clients.size) return;
    if (entry.reading) {
      entry.again = true;
      return;
    }
    entry.reading = true;
    let nextDelay = this.localCoalesceMs;
    try {
      const target = await this.targetFor(entry);
      if (!target) {
        this.unwatchWorker(entry.workerId);
        return;
      }
      nextDelay = target.kind === 'cloud' ? this.cloudCoalesceMs : this.localCoalesceMs;
      const busy = target.busy;
      const key = sessionKeyOf(target);
      if (entry.sessionKey !== key) {
        this.closeWatchers(entry);
        entry.lastDigest = undefined;
        entry.sessionKey = key;
        entry.kind = target.kind;
      }

      if (target.kind === 'local') {
        if (!target.local) {
          this.closeWatchers(entry);
          return;
        }
        entry.targetFileName = `${target.local.sessionId}.jsonl`;
        const paths = await this.opts.workerThreads.sessionPaths(target.local);
        if (this.stopped || entry.closed || !entry.clients.size) return;
        if (paths) this.applyPaths(entry, paths);
        const page = await this.opts.workerThreads.read(target.local, undefined, busy);
        if (this.stopped || entry.closed || !entry.clients.size) return;
        const after = await this.targetFor(entry);
        if (!after || sessionKeyOf(after) !== key || after.busy !== busy) {
          entry.again = true;
          return;
        }
        if (page.error && entry.lastDigest === undefined) return;
        await this.pushLive(entry, page, target.local);
        const digest = threadPageDigest(page, busy);
        if (digest === entry.lastDigest) return;
        entry.lastDigest = digest;
        this.push(entry, page);
        return;
      }

      const page = await this.opts.readCloud?.(entry.workerId);
      if (!page || this.stopped || entry.closed || !entry.clients.size) return;
      const after = this.opts.resolveWorker(entry.workerId);
      if (after?.kind !== 'cloud') return;
      if (after.busy !== busy) {
        entry.again = true;
        return;
      }
      if (page.error && entry.lastDigest === undefined) return;
      const digest = threadPageDigest(page, busy);
      if (digest === entry.lastDigest) return;
      entry.lastDigest = digest;
      this.push(entry, page);
    } finally {
      entry.reading = false;
      if (entry.again && !this.stopped && !entry.closed && entry.clients.size) {
        entry.again = false;
        this.schedule(entry, nextDelay);
      }
    }
  }

  private async pushLive(entry: WorkerWatch, page: ThreadPage, session?: ThreadSession): Promise<void> {
    if (entry.child || !this.opts.live) return;
    const live = await this.opts.live(entry.workerId, page.entries, session);
    if (!live || this.stopped || entry.closed || !entry.clients.size) return;
    const msg: ThreadLivePushMsg = { t: 'thread.live', workerId: entry.workerId, ...(page.sessionId ? { sessionId: page.sessionId } : {}), live };
    for (const clientId of entry.clients) {
      if (entry.liveRevs.get(clientId) === live.rev) continue;
      entry.liveRevs.set(clientId, live.rev);
      this.opts.send(clientId, msg);
    }
  }

  private push(entry: WorkerWatch, page: ThreadPage): void {
    const msg: ThreadPushMsg = {
      t: 'thread.snapshot',
      workerId: entry.workerId,
      request: 'push',
      push: true,
      ...(entry.child ? { child: entry.child } : {}),
      ...page,
    };
    for (const clientId of entry.clients) {
      this.opts.send(clientId, msg);
    }
  }

  private closeFileWatcher(entry: WorkerWatch): void {
    if (entry.fileWatcher) {
      try {
        entry.fileWatcher.close();
      } catch {
        // already closed
      }
      entry.fileWatcher = undefined;
    }
    entry.filePath = undefined;
  }

  private closeDirWatcher(entry: WorkerWatch): void {
    if (entry.dirWatcher) {
      try {
        entry.dirWatcher.close();
      } catch {
        // already closed
      }
      entry.dirWatcher = undefined;
    }
    entry.dirPath = undefined;
  }

  private closeWatchers(entry: WorkerWatch): void {
    this.closeFileWatcher(entry);
    this.closeDirWatcher(entry);
    this.clearMissing(entry);
  }

  private teardown(entry: WorkerWatch): void {
    entry.closed = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    this.closeWatchers(entry);
    entry.clients.clear();
  }
}

import type {
  Arrival,
  FloorInfo,
  FloorRoster,
  FloorView,
  GhIssue,
  GhPull,
  GhState,
  LeaveOnMergeState,
  FreshMainState,
  MachineState,
  ProjectInfo,
  ProjectsDirState,
  PromptsState,
  RepoChoice,
  Run,
  ScreenPlacement,
  ServerMsg,
  SubagentsState,
  UpgradeState,
  WorkerInfo,
  ClientMsg,
} from '../shared/protocol';
import { SUBAGENT_DEFAULTS } from '../shared/protocol';
import { WORKER_LABEL_DEFAULTS, type WorkerLabelState } from '../shared/worker-labels';
import { kittyImageSignature } from '../shared/kitty';
import { decodeScreenBitmap } from './term-kitty';
import type { ScreenBitmap, ScreenState } from './screen-state';
import { forgeWords, type ForgeWords } from '../shared/floors';
import type { JiraBoardState, JiraFloorState } from '../shared/jira';
import { DEFAULT_AUTOPILOT, type LinearBoardState, type LinearFloorState } from '../shared/linear';
import { emptyFactoryState, type FactoryState } from '../shared/factory';
import { emptyGeminiState, type GeminiConnectionState } from '../shared/gemini-vibes';
import { emptySetupState, type SetupState } from '../shared/setup';
import { emptySubscriptionsState, type SubscriptionsState } from '../shared/subscriptions';
import { teamOf } from '../shared/team';
import { missionAgent, type MissionControlState } from '../shared/mission-control';
import type { Visit } from '../shared/visits';
import type { WorktreeSetupState } from '../shared/worktree-setup';
import { NO_PIPELINES, type PipelinesState } from '../shared/pipelines';
import { WhiteboardSync } from './whiteboard-sync';

export type Topic =
  | 'workers'
  | 'building'
  | 'issues'
  | 'pulls'
  | 'project'
  | 'screens'
  | 'upgrade'
  | 'pipelines'
  | 'machine'
  | 'floors'
  | 'floor'
  | 'projectsDir'
  | 'repos'
  | 'leaveOnMerge'
  | 'freshMain'
  | 'subagents'
  | 'hiddenModels'
  | 'workerLabels'
  | 'prompts'
  | 'jira'
  | 'jiraBoard'
  | 'linear'
  | 'linearBoard'
  | 'factory'
  | 'gemini'
  | 'setup'
  | 'subscriptions'
  | 'worktreeSetup'
  | 'whiteboard'
  | 'visits'
  | 'missionControl';

export interface Profile {
  name: string;
  color: string;
}

const PROFILE_KEY = 'factory-flow.profile';
export const AVATAR_COLORS = ['#ff8a5b', '#4f86f7', '#06d6a0', '#ef476f', '#ffd166', '#9d4edd', '#00b4d8', '#f77f00'];

/** Your saved display name and color. */
export function loadProfile(): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (p && typeof p.name === 'string' && typeof p.color === 'string') {
      return { name: p.name, color: p.color };
    }
  } catch {
    // storage blocked
  }
  return null;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // storage blocked
  }
}

export interface Settings {
  rememberDeskModels: boolean;
}
const SETTINGS_KEY = 'factory-flow.settings';
const FLOOR_KEY = 'factory-flow.floor';

/** The floor you were last on, to come back to it after a reload. */
export function lastFloor(): string | null {
  try {
    return localStorage.getItem(FLOOR_KEY);
  } catch {
    return null;
  }
}

function rememberFloor(id: string | null) {
  try {
    if (id) localStorage.setItem(FLOOR_KEY, id);
  } catch {
    // storage blocked
  }
}

export function loadSettings(): Settings {
  const s: Settings = { rememberDeskModels: true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof saved?.rememberDeskModels === 'boolean') s.rememberDeskModels = saved.rememberDeskModels;
  } catch {
    // storage blocked
  }
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage blocked
  }
}

/** The worker whose worktree branch a pull request came from, if it is still at a desk. */
export function workerForPull(workers: Iterable<WorkerInfo>, pr: { number: number; headRefName: string }): WorkerInfo | undefined {
  for (const w of workers) if (w.pr?.number === pr.number || (w.worktree && w.worktree.branch === pr.headRefName)) return w;
  return undefined;
}

/** How the Whiteboard's batches reach the server: Net.send, once main.ts has a connection (see connectWhiteboard). */
let whiteboardSend: (msg: ClientMsg) => boolean = () => false;
export function connectWhiteboard(send: (msg: ClientMsg) => boolean) {
  whiteboardSend = send;
}

/** Shared empty row for blank terminal lines so `s.lines` stays dense (`length === rows`) without allocating per row. */
const EMPTY_RUNS: Run[] = [];

export class Store {
  /** This connection's transport id; never shown, never a player. */
  connection = '';
  /** Where the server last put this connection (see welcome, floor.enter). */
  arrival: Arrival | null = null;
  profile: Profile = { name: 'Guest', color: '#161616' };
  workers = new Map<string, WorkerInfo>();
  screens = new Map<string, ScreenState>();
  project: ProjectInfo | null = null;
  /** Every floor of the building, and the one you're on (null while there are none). */
  floors: FloorInfo[] = [];
  /** Every floor's workers and pull requests across the building, once received. */
  building = new Map<string, FloorRoster>();
  floor: string | null = null;
  /** Where the office looks for existing checkouts to add as floors. */
  projectsDir: ProjectsDirState = { dir: '', custom: false };
  /** The git checkouts found in the workspace folder, once asked for (see floor.repos). */
  repos: { list: RepoChoice[]; error?: string; loading: boolean; at: number } = { list: [], loading: false, at: 0 };
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: true };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: true };
  upgrade: UpgradeState = { available: false, phase: 'idle' };
  /** The office's clock minus performance.now(), from the quickest ping (see 'pong'). */
  private clock?: { offset: number; rtt: number };
  /** The floor's GitHub Actions runs, or its GitLab pipelines. */
  pipelines: PipelinesState = NO_PIPELINES;
  /** The office's Jira connection and this floor's epic. */
  jira: JiraFloorState = {};
  /** The Jira tab of the issue board; null on a floor without an epic. */
  jiraBoard: JiraBoardState | null = null;
  /** The office's Linear workspace, this floor's team and its autopilot. */
  linear: LinearFloorState = { autopilot: { ...DEFAULT_AUTOPILOT }, working: 0 };
  /** The Linear tab of the issue board; null on a floor without a Linear team. */
  linearBoard: LinearBoardState | null = null;
  /** How busy the office's machine is, and its worker limit. */
  machine: MachineState = { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: 0 };
  /** Outside the windows; null until the server says. */
  /** Whether workers whose pull request merged go home by themselves (⚙️ Settings). */
  leaveOnMerge: LeaveOnMergeState = { on: false };
  /** Whether fresh workers start from the latest of the default branch (⚙️ Settings). */
  freshMain: FreshMainState = { on: true };
  /** How workers hire subagents (⚙️ Settings → Subagents & visits), and where the Droid skill is. */
  subagents: SubagentsState = { ...SUBAGENT_DEFAULTS };
  hiddenModels: string[] = [];
  workerLabels: WorkerLabelState = { settings: { ...WORKER_LABEL_DEFAULTS }, running: 0, queued: 0 };
  workerAnswerMultiSelect = false;
  /** Each floor's Whiteboard as this window has it, with the owner's batches until they're committed (see whiteboard-sync.ts). */
  readonly whiteboard = new WhiteboardSync((msg) => whiteboardSend(msg));
  /** The office's prompts as rewritten in Settings, and the worker a new one starts on when nobody picks: the same on every floor. */
  prompts: PromptsState = { custom: {} };
  /** The office's Factory connection and every Factory feature's read state (see docs/factory.md). */
  factory: FactoryState = emptyFactoryState();
  /** Google Gemini Decisions (`gemini-decision-1`) connection and wake-filter telemetry. */
  gemini: GeminiConnectionState = emptyGeminiState();
  /** Droid installed and signed in, and whether the owner has been through the welcome (docs/subscriptions.md). */
  setup: SetupState = emptySetupState();
  /** DroidProxy, the subscriptions it serves, and which of their models can run now. */
  subscriptions: SubscriptionsState = emptySubscriptionsState();
  /** How new worktrees on this floor are set up, once Settings asked (see worktreeSetup.get); null before, or on another floor. */
  worktreeSetup: WorktreeSetupState | null = null;
  /** Every visit on the floor you're on (see shared/visits.ts), as the server last sent them. */
  visits: Visit[] = [];
  /** The building's agents (the Orchestrator and external bots), the same on every floor; undefined from an office that predates Mission Control. */
  missionControl: MissionControlState | undefined;
  /** The last speech bubble said during a visit, for whoever shows it ('visitSay'). */
  lastSay: { visit: string; worker: string; text: string } | null = null;
  private subs = new Map<Topic, Set<(workerId?: string) => void>>();

  /** Screen updates identify the worker, including images that finish decoding after the message. */
  on(topic: Topic, fn: (workerId?: string) => void) {
    let set = this.subs.get(topic);
    if (!set) this.subs.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(topic: Topic, workerId?: string) {
    this.subs.get(topic)?.forEach((fn) => fn(workerId));
  }

  /** The floor you're on. */
  currentFloor(): FloorInfo | undefined {
    return this.floors.find((f) => f.id === this.floor);
  }

  /** The office's clock (ms since 1970) as near as this page can tell. */
  officeNow(): number {
    return this.clock ? performance.now() + this.clock.offset : Date.now();
  }

  /** A worker on this floor, or a building agent in Mission Control (the Orchestrator once it has a session, an external bot). */
  worker(id: string): WorkerInfo | undefined {
    return this.workers.get(id) ?? missionAgent(this.missionControl, id)?.worker;
  }

  workerAtDesk(deskId: string): WorkerInfo | undefined {
    for (const w of this.workers.values()) if (w.deskId === deskId) return w;
    return undefined;
  }

  /** The subagents a worker on this floor hired, oldest first. */
  teamOf(leadId: string): WorkerInfo[] {
    return teamOf(this.workers.values(), leadId);
  }

  /** Everything on the floor you just arrived on, in place of the last one's. */
  private enter(v: FloorView) {
    this.floor = v.floor;
    rememberFloor(v.floor);
    this.project = v.project;
    this.workers = new Map(v.workers.map((w) => [w.id, w]));
    if (v.floor) this.building.set(v.floor, { floor: v.floor, workers: [...v.workers], pulls: [...v.pulls.items] });
    for (const prev of this.screens.values()) this.closeScreenBitmaps(prev);
    this.screens.clear(); // fresh full frames follow
    this.pendingImageSigs.clear();
    this.issues = v.issues;
    this.pulls = v.pulls;
    this.pipelines = v.pipelines ?? NO_PIPELINES;
    this.jira = v.jira ?? {};
    this.jiraBoard = v.jiraBoard ?? null;
    this.linear = v.linear ?? { autopilot: { ...DEFAULT_AUTOPILOT }, working: 0 };
    this.linearBoard = v.linearBoard ?? null;
    this.worktreeSetup = null;
    // The new floor's visits follow in their own message.
    this.visits = [];
    for (const t of ['floor', 'project', 'workers', 'issues', 'pulls', 'pipelines', 'jira', 'jiraBoard', 'linear', 'linearBoard', 'worktreeSetup', 'visits'] as Topic[]) this.emit(t);
  }

  private pendingImageSigs = new Map<string, string>();

  private closeScreenBitmaps(s: ScreenState, workerId?: string) {
    if (workerId) {
      const prefix = `${workerId}:`;
      for (const k of this.pendingImageSigs.keys()) {
        if (k.startsWith(prefix)) this.pendingImageSigs.delete(k);
      }
    }
    if (!s.bitmaps) return;
    for (const b of s.bitmaps.values()) {
      if (b.source && 'close' in b.source && typeof b.source.close === 'function') b.source.close();
    }
    s.bitmaps.clear();
  }

  constructor() {
    this.whiteboard.subscribe((floor) => {
      if (floor === this.floor) this.emit('whiteboard');
    });
  }

  apply(msg: ServerMsg) {
    this.whiteboard.handle(msg);
    switch (msg.t) {
      case 'welcome':
        this.connection = msg.connection;
        this.arrival = msg.arrival;
        this.floors = msg.floors;
        this.projectsDir = msg.projectsDir;
        this.upgrade = msg.upgrade;
        this.machine = msg.machine;
        this.clock = undefined; // compared again, in case it's another office (or the same one, restarted)
        this.leaveOnMerge = msg.leaveOnMerge ?? { on: false };
        this.freshMain = msg.freshMain ?? { on: true };
        this.subagents = msg.subagents ?? { ...SUBAGENT_DEFAULTS };
        this.hiddenModels = msg.hiddenModels ?? [];
        this.workerLabels = msg.workerLabels ?? { settings: { ...WORKER_LABEL_DEFAULTS }, running: 0, queued: 0 };
        this.emit('workerLabels');
        this.workerAnswerMultiSelect = msg.workerAnswerMultiSelect === true;
        this.emit('hiddenModels');
        this.prompts = msg.prompts ?? { custom: {} };
        this.factory = msg.factory ?? emptyFactoryState();
        this.gemini = msg.gemini ?? emptyGeminiState();
        this.setup = msg.setup ?? emptySetupState();
        this.subscriptions = msg.subscriptions ?? emptySubscriptionsState();
        this.missionControl = msg.missionControl;
        this.building = new Map((msg.building ?? []).map((r) => [r.floor, { floor: r.floor, workers: [...r.workers], pulls: [...r.pulls] }]));
        this.enter(msg);
        for (const t of ['upgrade', 'machine', 'floors', 'building', 'projectsDir', 'leaveOnMerge', 'freshMain', 'subagents', 'prompts', 'factory', 'gemini', 'setup', 'subscriptions', 'missionControl'] as Topic[]) this.emit(t);
        break;
      case 'floor.enter':
        this.arrival = msg.arrival;
        this.enter(msg);
        this.emit('building');
        break;
      case 'floors':
        this.floors = msg.floors;
        for (const id of this.building.keys()) if (!msg.floors.some((f) => f.id === id)) this.building.delete(id);
        for (const f of msg.floors) if (!this.building.has(f.id)) this.building.set(f.id, { floor: f.id, workers: [], pulls: [] });
        if (this.project) {
          const floor = this.currentFloor();
          if (floor) this.project.branch = floor.branch;
        }
        this.emit('floors');
        this.emit('building');
        break;
      case 'building.worker': {
        let r = this.building.get(msg.floor);
        if (!r) this.building.set(msg.floor, (r = { floor: msg.floor, workers: [], pulls: [] }));
        const idx = r.workers.findIndex((w) => w.id === msg.worker.id);
        if (idx >= 0) r.workers[idx] = msg.worker;
        else r.workers.push(msg.worker);
        this.emit('building');
        break;
      }
      case 'building.remove': {
        const r = this.building.get(msg.floor);
        if (r) r.workers = r.workers.filter((w) => w.id !== msg.workerId);
        if (msg.floor !== this.floor) {
          const old = this.screens.get(msg.workerId);
          if (old) this.closeScreenBitmaps(old, msg.workerId);
          if (this.screens.delete(msg.workerId)) this.emit('screens');
        }
        this.emit('building');
        break;
      }
      case 'building.pulls': {
        const r = this.building.get(msg.floor);
        if (r) r.pulls = msg.pulls;
        else this.building.set(msg.floor, { floor: msg.floor, workers: [], pulls: msg.pulls });
        this.emit('building');
        break;
      }
      case 'projectsDir':
        this.projectsDir = msg.state;
        this.emit('projectsDir');
        break;
      case 'floor.repos':
        this.repos = { list: msg.repos, error: msg.error, loading: false, at: Date.now() };
        this.emit('repos');
        break;
      case 'worker.update':
        this.workers.set(msg.worker.id, msg.worker);
        this.emit('workers');
        break;
      case 'worker.remove': {
        this.workers.delete(msg.workerId);
        const old = this.screens.get(msg.workerId);
        if (old) this.closeScreenBitmaps(old, msg.workerId);
        if (this.screens.delete(msg.workerId)) this.emit('screens');
        this.emit('workers');
        break;
      }
      case 'screen': {
        let s = this.screens.get(msg.workerId);
        let changed = false;
        let fresh = false;
        if (!s || s.cols !== msg.cols || s.rows !== msg.rows) {
          s = {
            cols: msg.cols,
            rows: msg.rows,
            lines: Array.from({ length: msg.rows }, () => EMPTY_RUNS),
            placements: msg.full ? msg.placements : s?.placements,
            bitmaps: s?.bitmaps,
            cursor: msg.cursor,
            version: s?.version ?? 0,
          };
          this.screens.set(msg.workerId, s);
          changed = true;
          fresh = true;
        } else if (msg.full) {
          for (let y = 0; y < msg.rows; y++) {
            const next = msg.lines[y] ?? EMPTY_RUNS;
            if (!sameRuns(s.lines[y], next)) {
              s.lines[y] = next;
              changed = true;
            }
          }
          if (s.lines.length > msg.rows) {
            s.lines.length = msg.rows;
            changed = true;
          }
          if (!samePlacements(s.placements, msg.placements)) {
            s.placements = msg.placements;
            changed = true;
          }
        }
        if (!msg.full || fresh) {
          for (const [k, v] of Object.entries(msg.lines)) {
            const y = Number(k);
            if (!sameRuns(s.lines[y], v)) {
              s.lines[y] = v;
              changed = true;
            }
          }
        }
        if (msg.above !== undefined && !sameAbove(s.above, msg.above)) {
          s.above = msg.above;
          changed = true;
        }
        if (!msg.full && msg.placements !== undefined && !samePlacements(s.placements, msg.placements)) {
          s.placements = msg.placements;
          changed = true;
        }
        if (msg.images) {
          const bitmaps = s.bitmaps ?? (s.bitmaps = new Map<number, ScreenBitmap>());
          for (const [rawId, img] of Object.entries(msg.images)) {
            const id = Number(rawId);
            const sig = kittyImageSignature(img);
            if (bitmaps.get(id)?.sig === sig) continue;
            const wid = msg.workerId;
            const pendingKey = `${wid}:${id}`;
            this.pendingImageSigs.set(pendingKey, sig);
            decodeScreenBitmap(img)
              .then((bmp) => {
                if (!bmp) return;
                const cur = this.screens.get(wid);
                if (!cur || this.pendingImageSigs.get(pendingKey) !== sig) {
                  bmp.close?.();
                  return;
                }
                this.pendingImageSigs.delete(pendingKey);
                const map = cur.bitmaps ?? (cur.bitmaps = new Map<number, ScreenBitmap>());
                const prev = map.get(id);
                if (prev?.source && 'close' in prev.source && typeof prev.source.close === 'function') prev.source.close();
                map.set(id, { source: bmp, width: bmp.width, height: bmp.height, sig });
                cur.version++;
                this.emit('screens', wid);
              })
              .catch(() => undefined);
          }
        }
        if (s.cursor[0] !== msg.cursor[0] || s.cursor[1] !== msg.cursor[1]) {
          s.cursor = msg.cursor;
          changed = true;
        }
        if (changed) {
          s.version++;
          this.emit('screens', msg.workerId);
        }
        break;
      }
      case 'gh.issues':
        this.issues = msg.state;
        this.emit('issues');
        break;
      case 'gh.pulls':
        this.pulls = msg.state;
        this.emit('pulls');
        break;
      case 'upgrade':
        this.upgrade = msg.state;
        this.emit('upgrade');
        break;
      case 'pong': {
        // The answer that came back quickest says best how the two clocks line up.
        const rtt = performance.now() - msg.at;
        if (this.clock && rtt >= this.clock.rtt) break;
        this.clock = { offset: msg.now - (msg.at + rtt / 2), rtt };
        break;
      }
      case 'pipelines':
        this.pipelines = msg.state;
        this.emit('pipelines');
        break;
      case 'jira':
        this.jira = msg.state;
        this.emit('jira');
        break;
      case 'jira.board':
        this.jiraBoard = msg.state;
        this.emit('jiraBoard');
        break;
      case 'linear':
        this.linear = msg.state;
        this.emit('linear');
        break;
      case 'linear.board':
        this.linearBoard = msg.state;
        this.emit('linearBoard');
        break;
      case 'machine':
        this.machine = msg.state;
        this.emit('machine');
        break;
      case 'leaveOnMerge':
        this.leaveOnMerge = msg.state;
        this.emit('leaveOnMerge');
        break;
      case 'freshMain':
        this.freshMain = msg.state;
        this.emit('freshMain');
        break;
      case 'models.hidden':
        this.hiddenModels = msg.ids;
        this.emit('hiddenModels');
        break;
      case 'workerLabels':
        this.workerLabels = msg.state;
        this.emit('workerLabels');
        break;
      case 'subagents':
        this.subagents = msg.state;
        this.emit('subagents');
        break;
      case 'prompts':
        this.prompts = msg.state;
        this.emit('prompts');
        break;
      case 'factory':
        this.factory = msg.state;
        this.emit('factory');
        break;
      case 'gemini':
        this.gemini = msg.state;
        this.emit('gemini');
        break;
      case 'setup':
        this.setup = msg.state;
        this.emit('setup');
        break;
      case 'subscriptions':
        this.subscriptions = msg.state;
        this.emit('subscriptions');
        break;
      case 'visits':
        this.visits = msg.visits;
        this.emit('visits');
        break;
      case 'missionControl':
        this.missionControl = msg.state;
        this.emit('missionControl');
        break;
      case 'worktreeSetup':
        if (msg.state.floor !== this.floor) break;
        this.worktreeSetup = msg.state;
        this.emit('worktreeSetup');
        break;
    }
  }
}

export const store = new Store();

function sameRuns(a: Run[] | undefined, b: Run[] | undefined): boolean {
  if (a === b) return true;
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (al !== bl) return false;
  for (let i = 0; i < al; i++) {
    const ar = a![i];
    const br = b![i];
    if (ar[0] !== br[0] || ar[1] !== br[1] || ar[2] !== br[2] || ar[3] !== br[3]) return false;
  }
  return true;
}

function sameAbove(a: Run[][] | undefined, b: Run[][] | undefined): boolean {
  if (a === b) return true;
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (al !== bl) return false;
  for (let i = 0; i < al; i++) if (!sameRuns(a![i], b![i])) return false;
  return true;
}

function samePlacements(a: ScreenPlacement[] | undefined, b: ScreenPlacement[] | undefined): boolean {
  if (a === b) return true;
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (al !== bl) return false;
  for (let i = 0; i < al; i++) {
    const ap = a![i];
    const bp = b![i];
    if (ap.id !== bp.id || ap.x !== bp.x || ap.y !== bp.y || ap.cols !== bp.cols || ap.rows !== bp.rows || ap.srcCol !== bp.srcCol || ap.srcRow !== bp.srcRow || ap.totalCols !== bp.totalCols || ap.totalRows !== bp.totalRows) return false;
  }
  return true;
}

/** How the floor you're on names things: GitHub's PRs and gh, or GitLab's MRs and glab. */
export function words(): ForgeWords {
  return forgeWords(store.project?.forge);
}

import { forgeWords, type Forge } from '../shared/floors';
import { lastRuns, type PipelineRun, type PipelinesState } from '../shared/pipelines';
import type { GhPull, GhState } from '../shared/protocol';
import type { SettingsCardTitle } from '../shared/settings-nav';

// What the Boards window decides without a page: its tabs, what each one shows on this floor, the
// tab remembered per floor, and the count on its button. Kept free of browser calls so the tests
// can import it.

export const BOARD_TABS = ['issues', 'pulls', 'pipelines', 'linear', 'jira'] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

export function isBoardTab(value: unknown): value is BoardTab {
  return typeof value === 'string' && (BOARD_TABS as readonly string[]).includes(value);
}

/** The tab a floor opens on when nothing is remembered. */
export const DEFAULT_BOARD_TAB: BoardTab = 'issues';

/** The tab's name: the forge says pull request or merge request. */
export function boardTabLabel(tab: BoardTab, forge?: Forge): string {
  switch (tab) {
    case 'issues':
      return 'Issues';
    case 'pulls':
      return forgeWords(forge).pull === 'merge request' ? 'Merge requests' : 'Pull requests';
    case 'pipelines':
      return 'Pipelines';
    case 'linear':
      return 'Linear';
    case 'jira':
      return 'Jira';
  }
}

/** What a floor offers the tabs: a plain folder has no forge, and Linear and Jira each need a connection and then a team or epic. */
export interface BoardsContext {
  plain: boolean;
  linear: { connected: boolean; team: boolean };
  jira: { connected: boolean; epic: boolean };
}

/** What a tab shows: its board, or why it can't yet and the Settings card that fixes it. */
export type TabAvailability = { kind: 'ready' } | { kind: 'plain' } | { kind: 'connect'; step: 'connection' | 'floor'; card: SettingsCardTitle };

export function tabAvailability(tab: BoardTab, ctx: BoardsContext): TabAvailability {
  if (tab === 'issues' || tab === 'pulls' || tab === 'pipelines') return ctx.plain ? { kind: 'plain' } : { kind: 'ready' };
  const connection = tab === 'linear' ? ctx.linear.connected : ctx.jira.connected;
  if (!connection) return { kind: 'connect', step: 'connection', card: tab === 'linear' ? 'Linear' : 'Jira' };
  const floor = tab === 'linear' ? ctx.linear.team : ctx.jira.epic;
  if (!floor) return { kind: 'connect', step: 'floor', card: tab === 'linear' ? "This floor's Linear team" : "This floor's Jira epic" };
  return { kind: 'ready' };
}

const TAB_KEY = 'factory-flow.boards-tab';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** The tab this floor's Boards window was last on, or the first one. */
export function loadBoardTab(storage: Reader | undefined, floor: string | null): BoardTab {
  try {
    const saved = storage?.getItem(`${TAB_KEY}.${floor ?? ''}`);
    if (isBoardTab(saved)) return saved;
  } catch {
    // storage blocked
  }
  return DEFAULT_BOARD_TAB;
}

export function saveBoardTab(storage: Writer | undefined, floor: string | null, tab: BoardTab) {
  try {
    storage?.setItem(`${TAB_KEY}.${floor ?? ''}`, tab);
  } catch {
    // storage blocked
  }
}

/** The tab after `tab` going `direction` (arrow keys wrap around). */
export function stepBoardTab(tab: BoardTab, direction: -1 | 1): BoardTab {
  const at = BOARD_TABS.indexOf(tab);
  return BOARD_TABS[(at + direction + BOARD_TABS.length) % BOARD_TABS.length];
}

/** An open pull request that needs you: its checks are failing or changes were requested. */
export function pullNeedsAttention(pull: Pick<GhPull, 'state' | 'isDraft' | 'checks' | 'reviewDecision'>): boolean {
  return pull.state === 'OPEN' && !pull.isDraft && (pull.checks === 'fail' || pull.reviewDecision === 'CHANGES_REQUESTED');
}

/** Workflows whose newest run failed, one per workflow: a workflow that failed and then passed no longer counts. */
export function failedLatestRuns(runs: readonly PipelineRun[]): PipelineRun[] {
  const newest = new Map<string, PipelineRun>();
  for (const run of lastRuns(runs, runs.length)) if (!newest.has(run.workflow)) newest.set(run.workflow, run);
  return [...newest.values()].filter((run) => run.state === 'failure');
}

export interface BoardsBadge {
  count: number;
  pulls: number;
  runs: number;
  /** For the button's title and label, e.g. "2 pull requests need attention, 1 run failed". */
  summary: string;
}

/** What the badge reads off the store: the floor, and the two boards that feed it. */
export interface BadgeSource {
  plain: boolean;
  forge?: Forge;
  pulls: Pick<GhState<GhPull>, 'items' | 'fetchedAt' | 'error'>;
  pipelines: Pick<PipelinesState, 'runs' | 'fetchedAt' | 'error'>;
}

/** The badge for a store's boards, counting a board only once it has loaded without an error. */
export function badgeFor(source: BadgeSource): BoardsBadge | undefined {
  const loaded = (s: { fetchedAt: number; error?: string }) => s.fetchedAt > 0 && !s.error;
  return boardsBadge({ plain: source.plain, forge: source.forge, pulls: loaded(source.pulls) ? source.pulls.items : undefined, runs: loaded(source.pipelines) ? source.pipelines.runs : undefined });
}

/** The count on the Boards button, or undefined while there's nothing to show: no data yet, a plain floor, or nothing needing you. */
export function boardsBadge(input: { plain: boolean; pulls?: readonly GhPull[]; runs?: readonly PipelineRun[]; forge?: Forge }): BoardsBadge | undefined {
  if (input.plain) return undefined;
  const pulls = input.pulls?.filter(pullNeedsAttention).length ?? 0;
  const runs = input.runs ? failedLatestRuns(input.runs).length : 0;
  const count = pulls + runs;
  if (!count) return undefined;
  const w = forgeWords(input.forge);
  const parts = [pulls ? `${pulls} ${w.pull}${pulls === 1 ? '' : 's'} ${pulls === 1 ? 'needs' : 'need'} attention` : '', runs ? `${runs} ${runs === 1 ? 'run' : 'runs'} failed` : ''].filter(Boolean);
  return { count, pulls, runs, summary: parts.join(', ') };
}

/** One row in ⌘K's Actions group: what it says, the words that also find it, and what it does. */
export interface PaletteEntry {
  id: string;
  label: string;
  /** Ranked in place of the label, so a query for the group keeps the entries in their own order. */
  group?: string;
  keywords?: string[];
  run(): void;
}

const TAB_KEYWORDS: Record<BoardTab, string[]> = {
  issues: ['tickets', 'bugs', 'board'],
  pulls: ['pr', 'mr', 'pull request', 'merge request', 'review', 'diff', 'board'],
  pipelines: ['actions', 'ci', 'workflow', 'runs', 'builds', 'checks'],
  linear: ['tickets', 'autopilot', 'board'],
  jira: ['epic', 'tickets', 'board'],
};

/** ⌘K's entries for the Boards window: one per tab. */
export function boardsPaletteEntries(open: (tab: BoardTab) => void, forge?: Forge): PaletteEntry[] {
  return BOARD_TABS.map((tab) => ({ id: `boards:${tab}`, label: `Boards: ${boardTabLabel(tab, forge)}`, group: 'Boards', keywords: [boardTabLabel(tab, forge), ...TAB_KEYWORDS[tab]], run: () => open(tab) }));
}

/** Message types the boards' dialogs and Settings wait on. */
export const BOARDS_REPLY_TYPES: ReadonlySet<string> = new Set(['gh.merged', 'gh.commented', 'gh.closed', 'gh.labeled', 'pipelines.done', 'pipelines.detail', 'linear.setup', 'jira.setup']);

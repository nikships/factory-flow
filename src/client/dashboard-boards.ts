import { repoChoices } from '../shared/floors';
import type { ClientMsg, ServerMsg, WorkerInfo } from '../shared/protocol';
import { isAsleep } from '../shared/status';
import type { SettingsCardTitle, SettingsPane } from '../shared/settings-nav';
import { isLive } from '../shared/pipelines';
import { badgeFor, boardTabLabel, loadBoardTab, saveBoardTab, stepBoardTab, tabAvailability, BOARD_TABS, type BoardsContext, type BoardTab } from './dashboard-boards-model';
import type { Net } from './net';
import { store } from './state';
import { createBoard, type Board, type BoardActions } from './ui/boards';
import { h, openModal, timeAgo, toast, type Modal } from './ui/dom';
import { openAsk } from './ui/ask';
import { renderJiraBoard, routeJiraMessage } from './ui/jira';
import { emptyState } from './ui/kit';
import { autopilotSummary, openNewLinearTicket, renderLinearBoard, routeLinearMessage } from './ui/linear';
import { createPipelines, routePipelinesMessage } from './ui/pipelines';
import { openPrompt } from './ui/prompt';
import { routePullMessage } from './ui/pull';

// The Boards window: the floor's issues, pull requests, pipelines, Linear tickets and Jira epic in
// one pop-up with a tab for each. It remembers its tab per floor and follows the companion to
// another floor (see `BoardsHost`).

/** What the window needs from the companion around it. */
export interface BoardsHost {
  net: Net;
  /** The floor the companion is on. */
  floor(): string;
  /** Sends a hire (`worker.spawn`) as the companion would and opens the worker it makes; why it was refused, if so. */
  spawn(msg: Extract<ClientMsg, { t: 'worker.spawn' }>, done: string, intendedFloor: string): Promise<string | undefined>;
  /** Opens that worker in the companion's workspace. */
  goToWorker(workerId: string): void;
  /** Opens Settings on a category, scrolled to a card. */
  openSettings(pane: SettingsPane, card?: SettingsCardTitle): void;
}

/** The companion feeds server messages through here so the boards' dialogs and Settings hear how their requests went. */
export function routeBoardsMessage(msg: ServerMsg) {
  routePullMessage(msg);
  routePipelinesMessage(msg);
  routeLinearMessage(msg);
  routeJiraMessage(msg);
}

/** What this floor offers the tabs, read off the store. */
export function boardsContext(): BoardsContext {
  return {
    plain: !!store.currentFloor()?.plain,
    linear: { connected: !!store.linear.connection, team: !!store.linear.setup },
    jira: { connected: !!store.jira.connection, epic: !!store.jira.epic },
  };
}

/** The count for the Boards button, from what the store already holds. */
export function currentBoardsBadge() {
  return badgeFor({ plain: !!store.currentFloor()?.plain, forge: store.project?.forge, pulls: store.pulls, pipelines: store.pipelines });
}

interface Panel {
  el: HTMLElement;
  /** Buttons that go in the window's header for this tab. */
  actions?: HTMLElement[];
  refresh?(): void;
  status?(): { text: string; title?: string; bad?: boolean };
  loading?(): boolean;
  dispose(): void;
}

let current: { modal: Modal; show(tab?: BoardTab): void } | undefined;

/** Whether the Boards window is open. */
export function boardsOpen(): boolean {
  return !!current;
}

/** Hand a task to a new worker through the companion's hire window; `link` assigns the issue or Linear ticket to it. */
function hireForTask(host: BoardsHost, title: string, prompt: string, link: { issue?: number; linear?: string }) {
  const intended = host.floor();
  const floor = store.currentFloor();
  openPrompt({
    title,
    subtitle: floor?.name,
    submitLabel: 'Hire Droid',
    initial: prompt,
    modelOption: true,
    imagesOption: true,
    recall: true,
    worktreeOption: !floor?.home && !floor?.plain && !!floor?.branch,
    repoOptions: repoChoices(store.floors, intended),
    onSubmit: (text, opts) => host.spawn({ t: 'worker.spawn', deskId: 'auto', kind: 'agent', prompt: text, ...opts, ...link }, 'Droid hired.', intended),
  });
}

/** Your own prompt about an issue or PR, for a worker already on the floor or a new one. */
function askWorker(host: BoardsHost, title: string, context: string) {
  const intended = host.floor();
  const floor = store.currentFloor();
  const awake = [...store.workers.values()].filter((w: WorkerInfo) => (w.kind === 'agent' || (w.kind === 'cloud' && !w.cloud?.error)) && !isAsleep(w.status));
  openAsk({
    title,
    context,
    newDesk: floor?.name ?? 'this floor',
    workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
    worktreeOption: !floor?.home && !floor?.plain && !!floor?.branch,
    modelOption: true,
    repoOptions: repoChoices(store.floors, intended),
    onSubmit: (prompt, to, worktree, model, effort, repos, images) => {
      if (to) host.net.send({ t: 'worker.prompt', workerId: to, prompt, images: images?.length ? images : undefined });
      else void host.spawn({ t: 'worker.spawn', deskId: 'auto', kind: 'agent', prompt, worktree, model, effort, repos, images: images?.length ? images : undefined }, 'Droid hired.', intended).then((error) => error && toast(error, 'warn'));
    },
  });
}

/** Opens the Boards window on `tab` (this floor's remembered one when absent), or turns the open one to it. */
export function openBoards(host: BoardsHost, tab?: BoardTab) {
  if (current) {
    current.show(tab);
    return;
  }
  const { net } = host;
  const actions: BoardActions = {
    assign: (prompt, title, issue, linear) => hireForTask(host, title, prompt, { issue, linear }),
    ask: (context, title) => askWorker(host, title, context),
    goToWorker: (id) => {
      modal.close();
      host.goToWorker(id);
    },
  };
  const jiraActions = { assign: (prompt: string, title: string) => actions.assign(prompt, title) };

  let floor = host.floor();
  let tab$: BoardTab = tab ?? loadBoardTab(localStorage, floor);
  let panel: Panel | undefined;
  /** What the shown tab depended on when it was drawn, so a change in Settings redraws it. */
  let shownKey = '';

  const status = h('p.sub.boards-status');
  const refresh = h('button.btn.sm', { type: 'button', title: 'Look again now' }, 'Refresh') as HTMLButtonElement;
  const headActions = h('div.actions', {}, refresh);
  const tabButtons = new Map<BoardTab, HTMLButtonElement>();
  const tabs = h('nav.tabs.boards-tabs', { role: 'tablist', 'aria-label': 'Boards' });
  for (const t of BOARD_TABS) {
    const b = h('button.tab', { type: 'button', role: 'tab', id: `boards-tab-${t}`, 'aria-controls': 'boards-panel', 'data-tab': t }) as HTMLButtonElement;
    b.addEventListener('click', () => show(t));
    tabButtons.set(t, b);
    tabs.append(b);
  }
  tabs.addEventListener('keydown', (e) => {
    const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    e.preventDefault();
    show(stepBoardTab(tab$, direction));
    tabButtons.get(tab$)?.focus();
  });
  const body = h('div.body.flush.boards-body', { role: 'tabpanel', id: 'boards-panel' });
  const el = h('div.modal.full.boards-window', { role: 'dialog', 'aria-label': 'Boards' }, h('header', {}, h('div.titles', {}, h('h2', {}, 'Boards'), status), headActions), tabs, body);

  const paintStatus = () => {
    const s = panel?.status?.() ?? { text: '' };
    status.textContent = s.text;
    status.title = s.title ?? '';
    status.classList.toggle('bad', !!s.bad);
    const reading = panel?.loading?.() ?? false;
    refresh.disabled = reading || !panel?.refresh;
    refresh.textContent = reading ? 'Reading…' : 'Refresh';
  };

  const paintTabs = () => {
    const forge = store.project?.forge;
    const ctx = boardsContext();
    for (const [t, b] of tabButtons) {
      const open =
        t === 'issues'
          ? store.issues.items.filter((i) => i.state === 'OPEN').length
          : t === 'pulls'
            ? store.pulls.items.filter((p) => p.state === 'OPEN').length
            : t === 'pipelines'
              ? store.pipelines.runs.filter((r) => isLive(r.state)).length
              : 0;
      const badge = currentBoardsBadge();
      const bad = t === 'pulls' ? (badge?.pulls ?? 0) : t === 'pipelines' ? (badge?.runs ?? 0) : 0;
      const ready = tabAvailability(t, ctx).kind === 'ready';
      b.replaceChildren(boardTabLabel(t, forge), ...(ready && open ? [h('span.n', {}, String(open))] : []), ...(bad ? [h('span.n.bad', { title: `${bad} need attention` }, `${bad}!`)] : []));
      b.classList.toggle('on', t === tab$);
      b.setAttribute('aria-selected', String(t === tab$));
      b.tabIndex = t === tab$ ? 0 : -1;
    }
    body.setAttribute('aria-labelledby', `boards-tab-${tab$}`);
  };

  const availabilityKey = (t: BoardTab) => {
    const a = tabAvailability(t, boardsContext());
    return a.kind === 'connect' ? `${a.kind}:${a.step}` : a.kind;
  };

  const unavailable = (t: BoardTab): Panel => {
    const a = tabAvailability(t, boardsContext());
    if (a.kind === 'plain') {
      return {
        el: emptyState(
          '📁',
          'This floor is a plain folder',
          'Plain folders are not git checkouts, so they have no issues, pull requests or pipelines. Add a git checkout as a floor to get the boards. Linear and Jira still work on any floor.',
        ),
        dispose() {},
      };
    }
    if (a.kind !== 'connect') return { el: h('div'), dispose() {} };
    const name = t === 'linear' ? 'Linear' : 'Jira';
    const [title, text, label] =
      a.step === 'connection'
        ? [
            `Connect ${name}`,
            t === 'linear' ? 'Connect your Linear workspace with an API key and its tickets show up here, ready to hand to a worker.' : 'Connect Jira with your site, email and an API token and an epic’s tickets show up here, read only.',
            'Open Settings',
          ]
        : [
            t === 'linear' ? 'Pick a Linear team for this floor' : 'Give this floor a Jira epic',
            t === 'linear' ? 'Each floor shows one Linear team, and optionally one of its projects. Pick this floor’s in Settings.' : 'Each floor shows the tickets of one Jira epic. Set this floor’s in Settings.',
            'Open Settings',
          ];
    const go = h('button.btn.primary', { type: 'button', onclick: () => host.openSettings('connections', a.card) }, `${label} → Connections`);
    return { el: emptyState('◆', title, text, go), dispose() {} };
  };

  const boardPanel = (kind: 'issues' | 'pulls'): Panel => {
    const board: Board = createBoard(kind, net, actions, paintStatus);
    return { el: board.el, refresh: board.refresh, status: board.status, loading: () => (kind === 'issues' ? store.issues.loading : store.pulls.loading), dispose: board.dispose };
  };

  const pipelinesPanel = (): Panel => {
    const pane = createPipelines(net, paintStatus);
    return { el: pane.el, actions: pane.actions, refresh: pane.refresh, status: pane.status, loading: pane.loading, dispose: pane.dispose };
  };

  const linearPanel = (): Panel => {
    const board = h('div.board-body');
    const pilot = h('button.btn.sm.linear-pilot', { type: 'button', onclick: () => net.send({ t: 'linear.autopilot', on: !store.linear.autopilot.on }) }) as HTMLButtonElement;
    const newTicket = h('button.btn.sm.primary', { type: 'button', title: 'Write a ticket in Linear', onclick: () => openNewLinearTicket(net) }, 'New ticket');
    const draw = () => {
      const { scrollLeft } = board;
      renderLinearBoard(board, actions, net);
      board.scrollLeft = scrollLeft;
      pilot.classList.toggle('on', store.linear.autopilot.on);
      pilot.setAttribute('aria-pressed', String(store.linear.autopilot.on));
      pilot.textContent = autopilotSummary();
      pilot.title = store.linear.autopilot.on ? 'Turn off autopilot: new tickets wait for you to hand them out' : 'Turn on autopilot: every new ticket gets a worker of its own (more in Settings → Connections)';
      paintStatus();
    };
    const unsubs = [store.on('linearBoard', draw), store.on('linear', draw), store.on('workers', draw)];
    const timer = setInterval(paintStatus, 15000);
    draw();
    return {
      el: board,
      actions: [pilot, newTicket],
      refresh: () => net.send({ t: 'linear.refresh' }),
      status() {
        const st = store.linearBoard;
        if (!st) return { text: '' };
        // The board keeps its last tickets when a refresh fails (and autopilot pauses), so say so.
        if (!st.loading && st.fetchedAt && st.error) return { text: `Couldn't refresh · updated ${timeAgo(st.fetchedAt)}`, title: st.error, bad: true };
        return { text: st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '' };
      },
      loading: () => !!store.linearBoard?.loading,
      dispose() {
        unsubs.forEach((u) => u());
        clearInterval(timer);
      },
    };
  };

  const jiraPanel = (): Panel => {
    const board = h('div.board-body');
    const draw = () => {
      const { scrollLeft } = board;
      renderJiraBoard(board, jiraActions);
      board.scrollLeft = scrollLeft;
      paintStatus();
    };
    const unsubs = [store.on('jiraBoard', draw)];
    const timer = setInterval(paintStatus, 15000);
    draw();
    return {
      el: board,
      refresh: () => net.send({ t: 'jira.refresh' }),
      status() {
        const st = store.jiraBoard;
        return { text: st ? (st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '') : '' };
      },
      loading: () => !!store.jiraBoard?.loading,
      dispose() {
        unsubs.forEach((u) => u());
        clearInterval(timer);
      },
    };
  };

  const build = (t: BoardTab): Panel => {
    if (tabAvailability(t, boardsContext()).kind !== 'ready') return unavailable(t);
    if (t === 'issues' || t === 'pulls') return boardPanel(t);
    if (t === 'pipelines') return pipelinesPanel();
    return t === 'linear' ? linearPanel() : jiraPanel();
  };

  function show(t: BoardTab, remember = true) {
    panel?.dispose();
    tab$ = t;
    if (remember) saveBoardTab(localStorage, floor, t);
    shownKey = availabilityKey(t);
    panel = build(t);
    body.replaceChildren(panel.el);
    headActions.replaceChildren(...(panel.actions ?? []), refresh);
    paintTabs();
    paintStatus();
  }

  refresh.addEventListener('click', () => panel?.refresh?.());

  // The companion moved to another floor: that floor's own tab, and its own boards.
  const onFloor = () => {
    floor = host.floor();
    show(loadBoardTab(localStorage, floor), false);
  };
  const onChange = () => {
    paintTabs();
    // Connecting Linear or Jira, or picking a team or epic, turns the tab's prompt into its board.
    if (availabilityKey(tab$) !== shownKey) show(tab$, false);
  };
  const unsubs = [store.on('floor', onFloor), store.on('project', paintTabs), store.on('issues', paintTabs), store.on('pulls', paintTabs), store.on('pipelines', paintTabs), store.on('linear', onChange), store.on('jira', onChange)];

  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      panel?.dispose();
      current = undefined;
    },
  });
  current = { modal, show: (t) => show(t ?? loadBoardTab(localStorage, floor), t !== undefined) };
  show(tab$, tab !== undefined);
  setTimeout(() => tabButtons.get(tab$)?.focus({ preventScroll: true }), 30);
}

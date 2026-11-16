/** The categories down the side of Settings, grouped so a setting's place can be guessed: what is only yours, what workers do, and what the whole office shares. */
export type SettingsPane = 'workers' | 'models' | 'subagents' | 'orchestrator' | 'connections' | 'office' | 'phone';

/** The sidebar groups, in order. Every pane belongs to exactly one. */
export type SettingsSection = 'Personal' | 'Workers' | 'Office';

/** Settings in a browser or in the Mac app's companion. */
export type SettingsSurface = 'companion' | 'mac-companion';

export interface PaneDef {
  id: SettingsPane;
  icon: string;
  label: string;
  section: SettingsSection;
  scope: string;
  blurb: string;
  /** The blurb in a companion, where the pane holds less. */
  companionBlurb?: string;
}

export const SETTINGS_PANES: PaneDef[] = [
  { id: 'workers', icon: '🤖', label: 'Workers', section: 'Workers', scope: 'Everyone', blurb: 'Where new workers start, how many run, when they leave, how their worktrees are set up and what the office tells them.' },
  { id: 'models', icon: '🧠', label: 'Models', section: 'Workers', scope: 'Everyone', blurb: 'The model a worker starts on, and which models the pickers offer.' },
  { id: 'subagents', icon: '🧭', label: 'Subagents & visits', section: 'Workers', scope: 'Everyone', blurb: 'Workers that hire workers at the desks near them, and workers visiting each other’s desks.' },
  {
    id: 'orchestrator',
    icon: '🛰️',
    label: 'Orchestrator',
    section: 'Workers',
    scope: 'Office-wide',
    blurb: 'The building’s own agent in Mission Control: whether it runs, the model it runs on, its conversation and its brief.',
  },
  {
    id: 'connections',
    icon: '🔌',
    label: 'Connections',
    section: 'Office',
    scope: 'Office-wide',
    blurb: 'Droid and Factory, the Claude or ChatGPT plans you already pay for, Gemini, Linear and Jira. Connect once; every floor uses them.',
  },
  {
    id: 'office',
    icon: '🏢',
    label: 'Office & floors',
    section: 'Office',
    scope: 'Office-wide',
    blurb: 'Where the office finds projects, and updates to the Mac app.',
    companionBlurb: 'Where the office finds projects, and updates to the Mac app.',
  },
  { id: 'phone', icon: '📱', label: 'Phone & web', section: 'Office', scope: 'Your devices', blurb: 'Factory Flow for Android, the web companion, and bots on your Tailscale devices.' },
];

/** Pane ids Settings used before a reorganization, and where those settings live now. Old links and callers keep working. */
const SETTINGS_PANE_ALIASES: Record<string, SettingsPane> = { factory: 'connections', subscriptions: 'connections', building: 'office', notify: 'workers' };

/** Where a pane id (current, or one from before a reorganization) lives now. */
export function resolveSettingsPane(want: string | undefined): SettingsPane | undefined {
  if (!want) return undefined;
  return SETTINGS_PANES.find((p) => p.id === want)?.id ?? SETTINGS_PANE_ALIASES[want];
}

/** Device controls are visible here; the server permits writes only from its own loopback page. */
const OWN_COMPUTER = ['companion', 'mac-companion'] as const;

export interface CardDef {
  pane: SettingsPane;
  title: string;
  keywords: string;
  /** The surfaces that show it; every one when absent. */
  on?: readonly SettingsSurface[];
}

/** Which category each setting lives in, and the words a search for it can use. The page is built from these titles. */
export const SETTINGS_CARDS = [
  { pane: 'workers', title: 'Where fresh workers start', keywords: 'fresh workers branch main floor branch checkout start' },
  { pane: 'workers', title: 'Worker limit', keywords: 'limit most workers at once max ceiling hire' },
  { pane: 'workers', title: 'Workers whose pull request merged', keywords: 'merged pull request go home leave stay worker cleanup' },
  { pane: 'workers', title: 'Worktree setup', keywords: 'worktree setup install command copy files new worker floor' },
  { pane: 'workers', title: 'Prompts', keywords: 'prompts edit wording handoffs reviews sign writer subagent visit brief' },
  { pane: 'workers', title: 'Worker labels', keywords: 'subject task summary activity sign writer model reasoning interval refresh conversation' },
  { pane: 'models', title: 'Default worker', keywords: 'default worker model effort agent new hire' },
  { pane: 'models', title: 'Remember models at desks', keywords: 'remember seat desk model effort hire' },
  { pane: 'models', title: 'Models shown in pickers', keywords: 'models hide hidden pickers visibility list' },
  { pane: 'subagents', title: 'Office MCP', keywords: 'factory flow office mcp tools subagents whiteboard cards visits on off' },
  { pane: 'subagents', title: 'Subagents', keywords: 'subagents hire team lead on off team_hire' },
  { pane: 'subagents', title: 'Team size', keywords: 'team size most subagents per lead max' },
  { pane: 'subagents', title: 'Where subagents work', keywords: 'subagents worktree checkout lead branch' },
  { pane: 'subagents', title: 'Waking the lead', keywords: 'waking lead wake report subagent rest' },
  { pane: 'subagents', title: 'Droid’s Task tool', keywords: 'task tool droid builtin subagent refuse deny team_hire' },
  { pane: 'subagents', title: 'Subagent worker', keywords: 'subagent default worker model effort lead' },
  { pane: 'subagents', title: 'Models leads can pick', keywords: 'subagent models leads pick limit notes credit' },
  { pane: 'subagents', title: 'Visits between workers', keywords: 'visits visit_roster workers desks talk handoff ask' },
  { pane: 'orchestrator', title: 'Orchestrator', keywords: 'orchestrator mission control building agent on off' },
  { pane: 'orchestrator', title: 'Orchestrator model', keywords: 'orchestrator model effort reasoning mission control' },
  { pane: 'orchestrator', title: 'New conversation', keywords: 'orchestrator new conversation reset forget start over fresh session' },
  { pane: 'orchestrator', title: 'Orchestrator brief', keywords: 'orchestrator brief prompt instructions edit mission control' },
  { pane: 'connections', title: 'Droid', keywords: 'droid version update sign in install agent account factory' },
  { pane: 'connections', title: 'Factory API key', keywords: 'factory api key connect cloud computers sessions credits ci autowiki' },
  { pane: 'connections', title: 'DroidProxy', keywords: 'droidproxy subscriptions claude chatgpt plan menu bar install start' },
  { pane: 'connections', title: 'Accounts', keywords: 'subscription accounts claude chatgpt plans usage connect remove' },
  { pane: 'connections', title: 'Models in Droid', keywords: 'subscription models droidproxy droid list update' },
  {
    pane: 'connections',
    title: 'Gemini Decisions API',
    keywords: 'gemini decision decisions api key google aistudio noise gate wakeup wake filter inter-agent chatter batch hold lead nudge',
  },
  { pane: 'connections', title: 'Linear', keywords: 'linear connect api key workspace tickets issues issue board' },
  { pane: 'connections', title: "This floor's Linear team", keywords: 'linear team project floor issue board tickets' },
  { pane: 'connections', title: 'Linear autopilot', keywords: 'linear autopilot automatic hire workers tickets todo backlog triage' },
  { pane: 'connections', title: 'Jira', keywords: 'jira connect atlassian account tickets issue board' },
  { pane: 'connections', title: "This floor's Jira epic", keywords: 'jira epic floor issue board tickets' },
  { pane: 'office', title: 'Workspace folder', keywords: 'workspace folder projects floor switcher floors git look for' },
  { pane: 'office', title: 'Host desktop app', keywords: 'host desktop mac app update version install restart' },
  { pane: 'phone', title: 'Factory Flow for Android', keywords: 'android phone pair pairing qr app mobile', on: OWN_COMPUTER },
  { pane: 'phone', title: 'Web companion', keywords: 'web companion dashboard browser pair desktop link', on: OWN_COMPUTER },
  { pane: 'phone', title: 'Tailscale MCP', keywords: 'tailscale mcp external remote bot openclaw grok grokbot agent serve url key connection', on: OWN_COMPUTER },
] as const satisfies readonly CardDef[];

export type SettingsCardTitle = (typeof SETTINGS_CARDS)[number]['title'];

const shows = (card: CardDef, surface: SettingsSurface) => !card.on || card.on.includes(surface);

/** The settings a surface shows, in sidebar order. */
export function settingsCards(surface: SettingsSurface = 'companion'): (typeof SETTINGS_CARDS)[number][] {
  return SETTINGS_CARDS.filter((c) => shows(c, surface));
}

/** The categories a surface shows: those with at least one of its settings, with the blurb that fits it. */
export function settingsPanes(surface: SettingsSurface = 'companion'): PaneDef[] {
  const cards = settingsCards(surface);
  return SETTINGS_PANES.filter((p) => cards.some((c) => c.pane === p.id)).map((p) => (p.companionBlurb ? { ...p, blurb: p.companionBlurb } : p));
}

/** One search hit: the setting, and the pane a click should open. */
export interface SettingsHit {
  pane: SettingsPane;
  title: SettingsCardTitle;
}

/**
 * The settings a search finds, in sidebar order. Every word in the query must appear in the
 * setting's title, its pane's label or section, or its keywords, so "jira epic" and "hide models"
 * both land. An empty query finds nothing (the caller shows the panes instead). Only `surface`'s settings count.
 */
export function searchSettings(query: string, surface: SettingsSurface = 'companion'): SettingsHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const paneOf = new Map(SETTINGS_PANES.map((p) => [p.id, p]));
  return settingsCards(surface)
    .filter((c) => {
      const pane = paneOf.get(c.pane)!;
      const hay = `${c.title} ${pane.label} ${pane.section} ${c.keywords}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map((c) => ({ pane: c.pane, title: c.title }));
}

/** The category arrow keys, Home and End land on, among `surface`'s. Anything else is left alone. */
export function settingsPaneAfter(current: SettingsPane, key: string, surface: SettingsSurface = 'companion'): SettingsPane | null {
  const panes = settingsPanes(surface);
  if (key === 'Home') return panes[0].id;
  if (key === 'End') return panes[panes.length - 1].id;
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[key];
  if (!step) return null;
  const i = panes.findIndex((p) => p.id === current);
  if (i < 0) return null;
  return panes[(i + step + panes.length) % panes.length].id;
}

/**
 * Resolves the category Settings opens on: `focusCard`'s registered pane when that card is offered
 * on `surface`, else `first` when offered, else `remembered` when offered, else `surface`'s first pane.
 */
export function initialSettingsPane(opts: { surface?: SettingsSurface; first?: SettingsPane; focusCard?: SettingsCardTitle; remembered?: SettingsPane }): SettingsPane {
  const surface = opts.surface ?? 'companion';
  const panes = settingsPanes(surface);
  if (opts.focusCard) {
    const card = settingsCards(surface).find((c) => c.title === opts.focusCard);
    if (card && panes.some((p) => p.id === card.pane)) return card.pane;
  }
  if (opts.first && panes.some((p) => p.id === opts.first)) return opts.first;
  if (opts.remembered && panes.some((p) => p.id === opts.remembered)) return opts.remembered;
  return panes[0].id;
}

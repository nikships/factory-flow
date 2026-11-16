import { latestArtifacts, type FactorySession } from '../shared/factory-sessions';

export const FACTORY_TABS = [
  { id: 'computers', label: 'Computers' },
  { id: 'wiki', label: 'AutoWiki' },
  { id: 'files', label: 'Files' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'ci', label: 'CI' },
] as const;

export type FactoryTab = (typeof FACTORY_TABS)[number]['id'];
export const FACTORY_TAB_KEY = 'factory-flow.factory.tab';

export function factoryTab(value: unknown): FactoryTab {
  return FACTORY_TABS.find((tab) => tab.id === value)?.id ?? 'computers';
}

export function lastFactoryTab(storage: Pick<Storage, 'getItem'>): FactoryTab {
  try {
    return factoryTab(storage.getItem(FACTORY_TAB_KEY));
  } catch {
    return 'computers';
  }
}

export function rememberFactoryTab(storage: Pick<Storage, 'setItem'>, tab: FactoryTab): void {
  try {
    storage.setItem(FACTORY_TAB_KEY, tab);
  } catch {
    // The open window still remembers its tab when browser storage is unavailable.
  }
}

/** Only pull requests opened or merged by sessions, never unrelated or unsafe artifact links. */
export function sessionPulls(items: readonly FactorySession[], max = 12) {
  const filtered = items.map((session) => ({
    ...session,
    artifacts: session.artifacts.filter((artifact) => {
      if (!artifact.url || !/^https?:\/\//i.test(artifact.url)) return false;
      const pull = /pull.?request|merge.?request/i.test(artifact.kind) || /\/(?:pull|merge_requests)\/\d+(?:[/?#]|$)/.test(artifact.url);
      return pull && (!artifact.action || /^(?:create|created|open|opened|merge|merged)$/i.test(artifact.action));
    }),
  }));
  return latestArtifacts(filtered, max);
}

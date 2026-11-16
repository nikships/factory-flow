import type { Net } from './net';
import { normalizeRepo, repoWebUrl } from '../shared/floors';
import { store } from './state';
import { FACTORY_TABS, lastFactoryTab, rememberFactoryTab, type FactoryTab } from './dashboard-factory-model';
import { refreshFactory } from './factory';
import { mountFilesTab, type FilesTab } from './ui/bookshelf';
import { h, openModal } from './ui/dom';
import { mountCiTab } from './ui/factory-ci';
import { mountComputersTab } from './ui/factory-computers';
import { mountSessionsTab } from './ui/factory-sessions';
import { mountWikiTab } from './ui/factory-wiki';
import { emptyState, windowHeader } from './ui/kit';

type TabBody = { dispose(): void; shown?(): void };
let opened: { floor: string | null; show(tab: FactoryTab): void; close(): void } | undefined;

export function factoryPaletteEntries(net: Net, nativeCompanion = false) {
  return FACTORY_TABS.map(({ id, label }) => ({ id: `factory-${id}`, label: `Factory: ${label}`, run: () => openFactoryWindow(net, { tab: id, nativeCompanion }) }));
}

export function openFactoryWindow(net: Net, opts: { tab?: FactoryTab; nativeCompanion?: boolean } = {}) {
  if (opened) {
    if (opened.floor === store.floor) {
      opened.show(opts.tab ?? lastFactoryTab(localStorage));
      return;
    }
    opened.close();
    if (opened) return;
  }
  const floor = store.floor;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const project = store.project;
  const floorInfo = store.floors.find((item) => item.id === floor);
  let selected = opts.tab ?? lastFactoryTab(localStorage);
  rememberFactoryTab(localStorage, selected);
  let files: FilesTab | undefined;
  const mounted = new Map<FactoryTab, TabBody>();
  const panels = new Map<FactoryTab, HTMLElement>();
  const buttons = new Map<FactoryTab, HTMLButtonElement>();
  const content = h('div.factory-window-content');
  const tabs = h('div.tabs.factory-window-tabs', { role: 'tablist', 'aria-label': 'Factory' });
  const connect = () => {
    void import('./ui/settings').then(({ openSettings }) => openSettings(net, { surface: opts.nativeCompanion ? 'mac-companion' : 'companion', first: 'connections', focusCard: 'Factory API key' }));
  };
  const unavailable = h('div.factory-window-empty');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const header = windowHeader('Factory', floorInfo ? `${floorInfo.name} · computers, repository and account activity` : 'Computers, repository and account activity');
  header.append(close);
  const el = h('div.modal.factory-window', { role: 'dialog', 'aria-label': 'Factory' }, header, tabs, unavailable, content);

  const show = (tab: FactoryTab) => {
    selected = tab;
    rememberFactoryTab(localStorage, tab);
    paint();
  };
  for (const { id, label } of FACTORY_TABS) {
    const panel = h('section.factory-window-panel', { id: `factory-panel-${id}`, role: 'tabpanel', 'aria-labelledby': `factory-tab-${id}`, hidden: true });
    const button = h('button.tab', { id: `factory-tab-${id}`, type: 'button', role: 'tab', 'aria-controls': panel.id, onclick: () => show(id) }, label);
    panels.set(id, panel);
    buttons.set(id, button);
    content.append(panel);
    tabs.append(button);
  }
  tabs.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = FACTORY_TABS.findIndex(({ id }) => buttons.get(id) === event.target);
    if (at < 0) return;
    const next = event.key === 'ArrowRight' ? (at + 1) % FACTORY_TABS.length : event.key === 'ArrowLeft' ? (at + FACTORY_TABS.length - 1) % FACTORY_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? FACTORY_TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    show(FACTORY_TABS[next].id);
    buttons.get(selected)?.focus();
  });
  const connected = () => store.factory.connection.connected && !store.factory.connection.rejected && !store.setup.airgapped;
  const mount = (tab: FactoryTab, panel: HTMLElement): TabBody => {
    switch (tab) {
      case 'computers':
        return mountComputersTab(panel, { settings: connect });
      case 'wiki': {
        panel.classList.add('factory-wiki', 'bs-wiki');
        return mountWikiTab(panel, { floor: floor!, openSettings: connect });
      }
      case 'files': {
        const repo = floorInfo?.repo;
        const blob = repo ? { url: `${repoWebUrl(repo)}${project?.forge === 'gitlab' ? '/-/blob/HEAD' : '/blob/HEAD'}`, site: project?.forge === 'gitlab' ? 'GitLab' : 'GitHub' } : undefined;
        files = mountFilesTab(panel, { floor: floor!, project: floorInfo?.name, blob, keyboardRoot: el, isActive: () => selected === 'files' && connected() });
        return files;
      }
      case 'sessions':
        return mountSessionsTab(panel);
      case 'ci': {
        const repo = normalizeRepo(project?.remote);
        return mountCiTab(panel, { floorRepo: repo && repo.split('/').length === 2 ? repo : undefined });
      }
    }
  };
  let shown: FactoryTab | undefined;
  function paint() {
    for (const { id } of FACTORY_TABS) {
      const on = selected === id;
      buttons.get(id)!.setAttribute('aria-selected', String(on));
      buttons.get(id)!.tabIndex = on ? 0 : -1;
      panels.get(id)!.hidden = !on;
    }
    const needsFloor = (selected === 'files' || selected === 'wiki') && !floor;
    const ready = connected() && !needsFloor;
    content.hidden = !ready;
    unavailable.hidden = ready;
    if (!ready) {
      unavailable.replaceChildren(
        needsFloor && connected()
          ? emptyState('▤', 'Choose a floor', 'Open a project floor to browse its files and Factory AutoWiki.')
          : emptyState(
              '▤',
              'Connect to Factory',
              store.setup.airgapped
                ? 'Factory is paused in Airgapped mode. Open Settings → Connections to connect Factory Flow.'
                : store.factory.connection.rejected
                  ? 'Factory rejected the saved API key. Check or replace it in Settings → Connections.'
                  : 'Connect Factory Flow with your Factory API key to use Computers, AutoWiki, Files, Sessions and CI.',
              h('button.btn.primary', { type: 'button', onclick: connect }, 'Settings → Connections'),
            ),
      );
      shown = undefined;
      return;
    }
    const panel = panels.get(selected)!;
    let body = mounted.get(selected);
    if (!body) {
      body = mount(selected, panel);
      mounted.set(selected, body);
    }
    if (shown !== selected) body.shown?.();
    shown = selected;
  }
  const tryClose = () => (files ? files.beforeClose(() => modal.close()) : modal.close());
  const off = store.on('factory', paint);
  const offSetup = store.on('setup', paint);
  const modal = openModal(el, {
    size: 'full',
    backdropCloses: false,
    escCloses: () => {
      tryClose();
      return false;
    },
    onClose: () => {
      off();
      offSetup();
      for (const body of mounted.values()) body.dispose();
      opened = undefined;
      returnFocus?.focus();
    },
  });
  close.addEventListener('click', tryClose);
  modal.backdrop.addEventListener('mousedown', (event) => {
    if (event.target === modal.backdrop) tryClose();
  });
  opened = { floor, show, close: tryClose };
  refreshFactory('computers');
  paint();
  buttons.get(selected)?.focus();
}

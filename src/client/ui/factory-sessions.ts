import { artifactLabel, compactCredits, isLive, sessionWebUrl, sessionWhere } from '../../shared/factory-sessions';
import { sessionPulls } from '../dashboard-factory-model';
import { refreshFactory, watchFactory } from '../factory';
import { store } from '../state';
import { h, timeAgo } from './dom';
import { emptyState } from './kit';

/** Read-only account activity. Polling and credit estimates use the existing server ledger. */
export function mountSessionsTab(root: HTMLElement) {
  root.classList.add('factory-sessions');
  const paint = () => {
    const state = store.factory.sessions;
    const { credits } = state;
    const live = state.items.filter(isLive);
    const computers = [...store.factory.computers.items, ...store.factory.computers.instances];
    const summary = (label: string, value: string) => h('div.factory-credit-stat', {}, h('span.eyebrow', {}, label), h('strong', {}, value));
    const link = (id: string, title: string) => h('a.factory-session-link', { href: sessionWebUrl(id), title, target: '_blank', rel: 'noopener noreferrer' }, title || 'Untitled session');
    const section = (title: string, count: number, body: HTMLElement) => h('section.section', {}, h('div.row.between', {}, h('h3', {}, title), h('span.pill', {}, String(count))), body);
    const peak = Math.max(1, ...credits.days.map((day) => day.credits));
    const bars = h(
      'div.factory-credit-bars',
      { role: 'list', 'aria-label': 'Daily credits over 7 days' },
      ...credits.days.map((day) => {
        const label = `${day.day}: ${day.credits.toLocaleString()} credits${day.estimated ? ' (estimated)' : ''}`;
        const fill = h('span.factory-credit-fill');
        fill.style.height = `${Math.max(0, (day.credits / peak) * 100)}%`;
        return h(
          'div.factory-credit-day',
          { role: 'listitem', title: label, 'aria-label': label },
          h('span.factory-credit-value', {}, compactCredits(day.credits)),
          h('div.factory-credit-track', {}, fill),
          h('span', {}, new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })),
        );
      }),
    );
    const sessions = h(
      'ul.list.boxed',
      {},
      ...live.map((session) => {
        const where = sessionWhere(state, computers, session);
        const location = where.kind === 'elsewhere' ? 'Another machine or the Factory web app' : where.label;
        return h('li.list-row', {}, h('span.list-main', {}, link(session.id, session.title), h('span.list-meta', { title: location }, `${location} · updated ${timeAgo(session.updatedAt)}`)), h('span.pill', {}, session.status));
      }),
    );
    const top = h(
      'ol.list.boxed',
      {},
      ...credits.top.map((session, index) =>
        h('li.list-row', {}, h('span.list-icon', {}, String(index + 1)), h('span.list-main', {}, link(session.id, session.title)), h('span.factory-credit-total', {}, `${compactCredits(session.credits)} credits`)),
      ),
    );
    const pulls = sessionPulls(state.items);
    const artifacts = h(
      'ul.list.boxed',
      {},
      ...pulls.map(({ artifact, session }) =>
        h(
          'li.list-row',
          {},
          h(
            'span.list-main',
            {},
            h('a.factory-session-link', { href: artifact.url, title: artifact.title ?? artifactLabel(artifact), target: '_blank', rel: 'noopener noreferrer' }, artifact.title ?? artifactLabel(artifact)),
            h('span.list-meta', { title: session.title }, `${artifactLabel(artifact)} · ${session.title || 'Untitled session'}`),
          ),
          h('span.pill', {}, /merge/i.test(artifact.action ?? '') ? 'Merged' : 'Opened'),
        ),
      ),
    );
    root.replaceChildren(
      h('div.row.between', {}, h('p.sub', {}, state.fetchedAt ? `Updated ${timeAgo(state.fetchedAt)} · read-only` : 'Reading Factory sessions…'), h('button.btn.sm', { type: 'button', onclick: () => refreshFactory('sessions') }, 'Refresh')),
      state.error ? h('p.note.bad', { role: 'status' }, state.error) : '',
      h('div.factory-credit-summary', {}, summary('Credits today', compactCredits(credits.today)), summary('Credits over 7 days', compactCredits(credits.week)), summary('Running now', String(live.length))),
      h(
        'section.section',
        {},
        h('h3', {}, 'Daily credits'),
        credits.days.length ? bars : h('p.sub', {}, 'Daily credits appear after Factory Flow reads session usage.'),
        h('p.factory-credit-note', {}, 'Credits include subagents. Estimated days place a session’s earlier usage on its last active day. Totals cover the sessions Factory Flow has observed, not an account billing statement.'),
      ),
      section('Running sessions', live.length, live.length ? sessions : emptyState('▤', state.fetchedAt ? 'No sessions running now' : 'Loading sessions', 'Running and pending Droid sessions appear here with where each runs.')),
      section('Top sessions this week', credits.top.length, credits.top.length ? top : h('p.sub', {}, 'No session credit usage recorded this week.')),
      section('Latest pull requests', pulls.length, pulls.length ? artifacts : h('p.sub', {}, 'No opened or merged pull requests in the recent sessions.')),
      state.hasMore ? h('p.factory-credit-note', {}, 'Showing the most recent 100 sessions. Older activity may not appear here.') : '',
    );
  };
  const stops = [watchFactory('sessions'), watchFactory('computers'), store.on('factory', paint)];
  const tick = setInterval(paint, 30_000);
  refreshFactory('sessions');
  paint();
  return {
    dispose() {
      for (const stop of stops) stop();
      clearInterval(tick);
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_CARDS, initialSettingsPane, resolveSettingsPane, searchSettings, settingsCards, settingsPaneAfter, settingsPanes } from '../src/shared/settings-nav.js';
test('companion settings retain workers, connections, office and device services', () => {
  for (const surface of ['companion', 'mac-companion'] as const) {
    assert.deepEqual(
      settingsPanes(surface).map((p) => p.id),
      ['workers', 'models', 'subagents', 'orchestrator', 'connections', 'office', 'phone'],
    );
    const titles = settingsCards(surface).map((c) => c.title);
    for (const title of ['Linear', 'Jira', 'Gemini Decisions API', 'Office MCP', 'Factory Flow for Android', 'Tailscale MCP', 'Web companion'] as const) assert.ok(titles.includes(title));
    assert.doesNotMatch(titles.join(' '), /Renderer|Jukebox|Office sounds|Your character|Outside|Hot reload/);
    assert.equal(new Set(titles).size, titles.length);
    for (const c of SETTINGS_CARDS) assert.ok(settingsPanes(surface).some((p) => p.id === c.pane));
  }
});
test('settings search and navigation stay within retained panes', () => {
  assert.deepEqual(searchSettings('jira epic'), [{ pane: 'connections', title: "This floor's Jira epic" }]);
  assert.deepEqual(searchSettings('hide models'), [{ pane: 'models', title: 'Models shown in pickers' }]);
  assert.deepEqual(searchSettings(''), []);
  assert.equal(settingsPaneAfter('workers', 'ArrowUp'), 'phone');
  assert.equal(settingsPaneAfter('phone', 'ArrowDown'), 'workers');
  assert.equal(settingsPaneAfter('models', 'Home'), 'workers');
  assert.equal(settingsPaneAfter('models', 'End'), 'phone');
  assert.equal(settingsPaneAfter('models', 'Escape'), null);
  assert.equal(resolveSettingsPane('factory'), 'connections');
  assert.equal(resolveSettingsPane('building'), 'office');
  assert.equal(resolveSettingsPane('graphics'), undefined);
  assert.equal(initialSettingsPane({ focusCard: 'Jira', first: 'models' }), 'connections');
});

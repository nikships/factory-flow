import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { androidIntentDeepLink, appDeepLink, cardDeepLink, floorDeepLink, normalizeDeepLinkBase, officeDeepLink, parseDeepLink, pickDeepLinkBase, questionDeepLink, webDeepLink, workerDeepLink } from '../src/shared/deep-links.js';
import { serveDeepLinkBounce } from '../src/server/deep-links.js';
import type { GrokWebhookPayload } from '../src/server/grok-webhook.js';
import { createOfficeMcp, OFFICE_MCP_PATH, OFFICE_MCP_WORKER_HEADER } from '../src/server/office-mcp/index.js';
import { RemoteOffice, type RemoteFloor } from '../src/server/remote-office.js';
import { RemoteWorkers } from '../src/server/remote-workers.js';
import { Team, type TeamWorkers } from '../src/server/team.js';
import { Visits } from '../src/server/visits.js';
import { WhiteboardStore } from '../src/server/whiteboard.js';
import { SUBAGENT_DEFAULTS, type WorkerInfo } from '../src/shared/protocol.js';

const TAILNET_BASE = 'http://office-mac.tailnet-name.ts.net:4700';

test('shared deep link builders and parser cover worker, floor, card and question URLs while rejecting pairing links', () => {
  assert.equal(normalizeDeepLinkBase('HTTP://Office-Mac.Tailnet-Name.ts.net:4700/some/path?x=1'), TAILNET_BASE);
  assert.equal(normalizeDeepLinkBase('https://office.ts.net:443/open'), 'https://office.ts.net');
  assert.equal(normalizeDeepLinkBase('http://user:pass@office.ts.net:4700'), undefined);
  assert.equal(normalizeDeepLinkBase('ftp://office.ts.net:4700'), undefined);

  assert.equal(
    pickDeepLinkBase([
      { url: 'http://192.168.1.20:4700', kind: 'wifi' },
      { url: 'http://100.101.102.103:4700', kind: 'tailscale' },
      { url: `${TAILNET_BASE}/`, kind: 'tailscale', dns: true },
    ]),
    TAILNET_BASE,
  );
  assert.equal(
    pickDeepLinkBase([
      { url: 'not-a-valid-url', kind: 'tailscale', dns: true },
      { url: 'http://192.168.1.20:4700', kind: 'wifi' },
      { url: 'http://100.101.102.103:4700', kind: 'tailscale' },
    ]),
    'http://100.101.102.103:4700',
  );
  assert.equal(pickDeepLinkBase([{ url: 'http://192.168.1.20:4700', kind: 'wifi' }]), 'http://192.168.1.20:4700');
  assert.equal(pickDeepLinkBase([]), undefined);

  const workerHttp = workerDeepLink('gizmo-c1cb', 'factory-flow', TAILNET_BASE);
  assert.equal(workerHttp, `${TAILNET_BASE}/open/worker/gizmo-c1cb?floor=factory-flow`);
  assert.deepEqual(parseDeepLink(`Tap here: ${workerHttp}.`), {
    target: { kind: 'worker', workerId: 'gizmo-c1cb', floorId: 'factory-flow' },
    officeBase: TAILNET_BASE,
  });
  // Finds the deep link even when an unrelated PR/docs URL appears earlier in the chat message.
  assert.deepEqual(parseDeepLink(`PR https://github.com/nikships/factory-flow/pull/1 is up — open ${workerHttp}`), {
    target: { kind: 'worker', workerId: 'gizmo-c1cb', floorId: 'factory-flow' },
    officeBase: TAILNET_BASE,
  });

  const workerThread = webDeepLink(TAILNET_BASE, { kind: 'worker', workerId: 'gizmo-c1cb', floorId: 'factory-flow', view: 'thread' });
  assert.equal(workerThread, `${TAILNET_BASE}/open/worker/gizmo-c1cb?floor=factory-flow&view=thread`);
  assert.deepEqual(parseDeepLink(workerThread), {
    target: { kind: 'worker', workerId: 'gizmo-c1cb', floorId: 'factory-flow', view: 'thread' },
    officeBase: TAILNET_BASE,
  });

  const floorHttp = floorDeepLink('factory-flow', TAILNET_BASE);
  assert.equal(floorHttp, `${TAILNET_BASE}/open/floor/factory-flow`);
  assert.deepEqual(parseDeepLink(floorHttp), {
    target: { kind: 'floor', floorId: 'factory-flow' },
    officeBase: TAILNET_BASE,
  });

  const cardHttp = cardDeepLink('card-9f2a', 'factory-flow', TAILNET_BASE);
  assert.equal(cardHttp, `${TAILNET_BASE}/open/card/card-9f2a?floor=factory-flow`);
  assert.deepEqual(parseDeepLink(cardHttp), {
    target: { kind: 'card', cardId: 'card-9f2a', floorId: 'factory-flow' },
    officeBase: TAILNET_BASE,
  });

  const askId = 'ask:factory-flow:gizmo-c1cb:a1b2c3d4e5f6';
  const questionHttp = questionDeepLink('gizmo-c1cb', 'factory-flow', askId, TAILNET_BASE);
  assert.equal(questionHttp, `${TAILNET_BASE}/open/question/gizmo-c1cb?floor=factory-flow&ask=ask%3Afactory-flow%3Agizmo-c1cb%3Aa1b2c3d4e5f6`);
  assert.deepEqual(parseDeepLink(questionHttp), {
    target: { kind: 'question', workerId: 'gizmo-c1cb', floorId: 'factory-flow', questionId: askId },
    officeBase: TAILNET_BASE,
  });

  // Composite ask IDs passed directly as the path segment also parse cleanly.
  assert.deepEqual(parseDeepLink(`factoryflow://question/${encodeURIComponent(askId)}?u=${encodeURIComponent(TAILNET_BASE)}`), {
    target: { kind: 'question', workerId: 'gizmo-c1cb', floorId: 'factory-flow', questionId: askId },
    officeBase: TAILNET_BASE,
  });

  // Loopback-only fallback uses factoryflow://open/... with zero tokens.
  assert.equal(officeDeepLink({ kind: 'worker', workerId: 'w-1', floorId: 'alpha' }, undefined), 'factoryflow://open/worker/w-1?floor=alpha');
  assert.equal(appDeepLink({ kind: 'card', cardId: 'c-1', floorId: 'alpha' }, { base: TAILNET_BASE, office: 'off-1' }), `factoryflow://open/card/c-1?floor=alpha&u=${encodeURIComponent(TAILNET_BASE)}&office=off-1`);

  // Android intent:// bounce URI preserves target, base, and browser fallback URL without hardcoding package.
  const intentUri = androidIntentDeepLink({ kind: 'worker', workerId: 'gizmo-c1cb', floorId: 'factory-flow' }, { base: TAILNET_BASE, fallbackUrl: `${TAILNET_BASE}/open/worker/gizmo-c1cb?floor=factory-flow&stay=1` });
  assert.match(intentUri, /^intent:\/\/open\/worker\/gizmo-c1cb\?floor=factory-flow&u=http%3A%2F%2Foffice-mac\.tailnet-name\.ts\.net%3A4700#Intent;scheme=factoryflow;S\.browser_fallback_url=/);
  assert.doesNotMatch(intentUri, /package=/);

  // Pairing invites and token-bearing join links are strictly rejected.
  assert.equal(parseDeepLink('factoryflow://pair?v=1&t=secret&u=http%3A%2F%2F192.168.1.20%3A4700'), undefined);
  assert.equal(parseDeepLink(`${TAILNET_BASE}/?t=secret`), undefined);
  assert.equal(parseDeepLink(`${TAILNET_BASE}/open/worker/w-1?t=secret`), undefined);
  assert.equal(parseDeepLink(`${TAILNET_BASE}/dashboard`), undefined);
  assert.equal(parseDeepLink('factoryflow://open/unknown/w-1'), undefined);
});

test('/open links open the Android app with a dashboard fallback and keep other browsers on the companion', async (t) => {
  const server = createServer((req, res) => serveDeepLinkBounce(req, res, req.url ?? '/open', 'http', TAILNET_BASE));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const targets = [
    ['/open/worker/w-1?floor=alpha', 'worker/w-1?floor=alpha', '/dashboard#floor=alpha&worker=w-1'],
    ['/open/worker/w-1?floor=alpha&view=thread', 'worker/w-1?floor=alpha&view=thread', '/dashboard#floor=alpha&worker=w-1&view=thread'],
    ['/open/question/w-ask?floor=alpha&ask=team%3Aalpha%3A4&office=off-9', 'question/w-ask?floor=alpha&ask=team%3Aalpha%3A4', '/dashboard#floor=alpha&worker=w-ask&view=thread'],
    ['/open/floor/alpha', 'floor/alpha', '/dashboard#floor=alpha'],
    ['/open/card/c-one?floor=alpha', 'card/c-one?floor=alpha', '/dashboard#floor=alpha&card=c-one'],
  ];
  const android = 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36';
  for (const [route, native, target] of targets) {
    const res = await fetch(origin + route, { redirect: 'manual', headers: { 'user-agent': android } });
    const query = native.includes('?') ? '&' : '?';
    const office = route.includes('office=') ? '&office=off-9' : '';
    const expected = `intent://open/${native}${query}u=${encodeURIComponent(origin)}${office}#Intent;scheme=factoryflow;package=ai.factory.factoryflow;S.browser_fallback_url=${encodeURIComponent(origin + target)};end`;
    assert.equal(res.status, 302);
    const location = res.headers.get('location')!;
    assert.equal(location, expected);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    const appUrl = location.split('#Intent;')[0].replace('intent:', 'factoryflow:');
    assert.deepEqual(parseDeepLink(appUrl), parseDeepLink(origin + route), 'the app receives the same target and office');
    const fallback = new URL(decodeURIComponent(location.split('S.browser_fallback_url=')[1].slice(0, -';end'.length)));
    assert.equal(fallback.origin, origin);
    assert.equal(fallback.pathname, '/dashboard');
    assert.equal(fallback.hash, new URL(origin + target).hash);
    for (const ua of ['Macintosh', 'iPhone', 'Androidish', '']) {
      const res = await fetch(origin + route, { redirect: 'manual', headers: { 'user-agent': ua } });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), target);
    }
  }
  assert.equal((await fetch(`${origin}/open/worker/w?t=secret`, { headers: { 'user-agent': android } })).status, 404, 'token-bearing deep links are rejected');
  const head = await fetch(`${origin}/open/floor/alpha`, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': android } });
  assert.equal(head.status, 302);
  assert.match(head.headers.get('location')!, /^intent:\/\/open\/floor\/alpha\?/);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${origin}/open/floor/alpha`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/open/not-a-kind/alpha`)).status, 404);
});

test('Android intents preserve an explicit office base but keep the browser fallback on this office', async (t) => {
  const server = createServer((req, res) => serveDeepLinkBounce(req, res, req.url ?? '/open', 'http', TAILNET_BASE));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const route = `/open/worker/w-1?floor=alpha&u=${encodeURIComponent(TAILNET_BASE)}&office=off-9`;
  const res = await fetch(origin + route, { redirect: 'manual', headers: { 'user-agent': 'Android' } });
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get('location'),
    `intent://open/worker/w-1?floor=alpha&u=${encodeURIComponent(TAILNET_BASE)}&office=off-9#Intent;scheme=factoryflow;package=ai.factory.factoryflow;S.browser_fallback_url=${encodeURIComponent(`${origin}/dashboard#floor=alpha&worker=w-1`)};end`,
  );
});

test('Office MCP tools and Grok Bot webhooks return clickable Tailscale deepLink fields across workers, floors, cards and questions', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deep-links-mcp-'));
  const store = new RemoteWorkers(dir);
  const settings = { ...SUBAGENT_DEFAULTS, visits: true, wakeLead: false, maxPerLead: 4 };
  const floors: RemoteFloor[] = [];
  const webhookDeliveries: GrokWebhookPayload[] = [];
  const office = new RemoteOffice(store, () => floors, {
    deepLinkBase: () => TAILNET_BASE,
    fetchImpl: async (_input, init) => {
      webhookDeliveries.push(JSON.parse(String(init?.body ?? '{}')) as GrokWebhookPayload);
      return new Response('ok', { status: 200 });
    },
  });
  const people = new Map<string, WorkerInfo>();
  let seq = 0;

  const alphaDir = path.join(dir, 'alpha');
  mkdirSync(alphaDir, { recursive: true });
  const get = (id: string) => people.get(id) ?? store.identity(id);
  const workers: TeamWorkers & RemoteFloor['workers'] = {
    list: () => [...people.values()],
    get: (id) => people.get(id),
    authenticate: (id, token) => (token === `tok-${id}` ? people.get(id) : undefined),
    releaseLead: (id) => {
      for (const w of people.values()) if (w.lead === id) delete w.lead;
    },
    officeDefault: undefined,
    deskOccupied: (id) => [...people.values()].some((w) => w.deskId === id),
    hire: (deskId, _by, prompt, _worktree, _choice, lead) => {
      const w: WorkerInfo = {
        id: `sub-${++seq}`,
        name: `Sub${seq}`,
        kind: 'agent',
        deskId,
        lead,
        task: prompt,
        color: '#ff6a00',
        status: 'idle',
        acked: true,
        createdAt: 1000 + seq,
        createdBy: 'test',
        cols: 100,
        rows: 30,
        open: false,
      };
      people.set(w.id, w);
      return w;
    },
    prompt: () => undefined,
    resume: () => undefined,
    kill: async (wid) => {
      people.delete(wid);
      return {};
    },
    tail: () => 'ready>',
    setTask() {},
  };
  const team = new Team({ ...workers, get }, { dataDir: alphaDir, dir: alphaDir, git: false, settings: () => settings, toast() {} });
  const visits = new Visits({ ...workers, get, tell: workers.prompt, cancelTurn: () => false, turnScreen: () => undefined }, { on: () => settings.visits, emit() {} });
  const whiteboard = new WhiteboardStore(alphaDir);
  floors.push({ id: 'alpha', dir: alphaDir, def: { name: 'Alpha' }, workers, team, visits, whiteboard });

  const localLead: WorkerInfo = {
    id: 'lead-1',
    name: 'Atlas',
    kind: 'agent',
    deskId: 'desk-1',
    color: '#00cc88',
    status: 'idle',
    acked: true,
    createdAt: 500,
    createdBy: 'owner',
    cols: 100,
    rows: 30,
    open: false,
  };
  const independent: WorkerInfo = {
    id: 'ind-1',
    name: 'Nova',
    kind: 'agent',
    deskId: 'desk-2',
    color: '#3399ff',
    status: 'working',
    acked: true,
    createdAt: 600,
    createdBy: 'owner',
    cols: 100,
    rows: 30,
    open: false,
  };
  people.set(localLead.id, localLead);
  people.set(independent.id, independent);
  const bot = office.add('Grok Bot');
  store.setGrokBot(bot.worker.id, {
    enabled: true,
    webhookUrl: 'https://grok.example/webhook',
    webhookToken: 'whsec_super_secret_token_123456',
  });

  const sharedDeps = {
    settings: () => settings,
    deepLinkBase: () => TAILNET_BASE,
    remote: office,
    owner: {
      floors: () =>
        floors.map((f) => ({
          id: f.id,
          name: f.def.name || f.id,
          dir: f.dir,
          workers: f.workers.list(),
        })),
      mission: () => [{ worker: bot.worker, team: [] }],
      tail: () => 'ready>',
      act: async () => ({ notes: [] }),
    },
    floor: (workerId: string) => {
      const f = floors.find((x) => x.workers.get(workerId));
      return f ? { ...f, name: f.def.name } : undefined;
    },
  };
  const localMcp = createOfficeMcp(sharedDeps);
  const remoteMcp = createOfficeMcp({
    ...sharedDeps,
    remoteTransport: { hostname: () => '127.0.0.1', owner: () => undefined },
  });

  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token === bot.token) {
      await remoteMcp.handle(req, res);
      return;
    }
    await localMcp.handle(req, res);
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const port = (httpServer.address() as AddressInfo).port;
  const endpoint = new URL(`http://127.0.0.1:${port}${OFFICE_MCP_PATH}`);

  async function connectAs(workerId: string, token: string) {
    const client = new Client({ name: `test-${workerId}`, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: {
          authorization: `Bearer ${token}`,
          [OFFICE_MCP_WORKER_HEADER]: workerId,
        },
      },
    });
    await client.connect(transport);
    t.after(() => client.close());
    return client;
  }

  t.after(() => {
    httpServer.close();
    whiteboard.stop();
    team.stop();
    visits.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const botClient = await connectAs(bot.worker.id, bot.token);
  const leadClient = await connectAs(localLead.id, `tok-${localLead.id}`);

  // 1. office_floors & office_roster & office_look
  const floorsRes = await botClient.callTool({ name: 'office_floors', arguments: {} });
  const floorsStruct = floorsRes.structuredContent as { floors: Array<{ id: string; deepLink: string }> };
  assert.equal(floorsStruct.floors[0]?.deepLink, `${TAILNET_BASE}/open/floor/alpha`);

  const rosterRes = await botClient.callTool({ name: 'office_roster', arguments: {} });
  const rosterStruct = rosterRes.structuredContent as {
    floors: Array<{ id: string; deepLink: string }>;
    workers: Array<{ id: string; deepLink: string; questionDeepLink?: string }>;
  };
  assert.equal(rosterStruct.floors[0]?.deepLink, `${TAILNET_BASE}/open/floor/alpha`);
  assert.equal(rosterStruct.workers.find((w) => w.id === 'lead-1')?.deepLink, `${TAILNET_BASE}/open/worker/lead-1?floor=alpha`);

  const lookRes = await botClient.callTool({ name: 'office_look', arguments: { worker: 'lead-1', lines: 5 } });
  assert.equal((lookRes.structuredContent as { deepLink?: string }).deepLink, `${TAILNET_BASE}/open/worker/lead-1?floor=alpha`);

  // 2. team_hire, team_message, team_watch, worker_log
  const hireRes = await botClient.callTool({
    name: 'team_hire',
    arguments: { floor: 'alpha', title: 'Check deep links', brief: 'Verify links', worktree: false },
  });
  const hireStruct = hireRes.structuredContent as { deepLink: string; worker: { id: string; deepLink: string } };
  const subId = hireStruct.worker.id;
  assert.equal(hireStruct.deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);
  assert.equal(hireStruct.worker.deepLink, hireStruct.deepLink);

  const msgRes = await botClient.callTool({
    name: 'team_message',
    arguments: { worker: subId, floor: 'alpha', text: 'Carry on' },
  });
  const msgStruct = msgRes.structuredContent as { deepLink: string; worker: { id: string; deepLink: string } };
  assert.equal(msgStruct.deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);
  assert.equal(msgStruct.worker.deepLink, msgStruct.deepLink);

  const broadcastRes = await botClient.callTool({
    name: 'team_message',
    arguments: { workers: [subId], floor: 'alpha', text: 'Broadcast check' },
  });
  const broadcastStruct = broadcastRes.structuredContent as { results: Array<{ id: string; deepLink: string }> };
  assert.equal(broadcastStruct.results[0]?.deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);

  const watchRes = await botClient.callTool({
    name: 'team_watch',
    arguments: { worker: 'ind-1', floor: 'alpha' },
  });
  const watchStruct = watchRes.structuredContent as { watching: Array<{ id: string; deepLink: string }> };
  assert.equal(watchStruct.watching.find((w) => w.id === 'ind-1')?.deepLink, `${TAILNET_BASE}/open/worker/ind-1?floor=alpha`);

  const logRes = await botClient.callTool({
    name: 'worker_log',
    arguments: { worker: subId, floor: 'alpha', tail: 0 },
  });
  assert.equal((logRes.structuredContent as { deepLink: string }).deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);

  // 3. Subagent question -> questions_list, team_status, team_wait, team_report_get, Grok Bot webhook
  const subClient = await connectAs(subId, `tok-${subId}`);
  const whoamiRes = await subClient.callTool({ name: 'office_whoami', arguments: {} });
  assert.equal((whoamiRes.structuredContent as { deepLink: string }).deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);
  assert.equal((whoamiRes.structuredContent as { floorDeepLink: string }).floorDeepLink, `${TAILNET_BASE}/open/floor/alpha`);

  await subClient.callTool({
    name: 'team_report',
    arguments: { text: 'Which scheme should we prefer?', question: true, options: ['HTTPS bounce', 'Custom scheme'] },
  });

  const qListRes = await botClient.callTool({ name: 'questions_list', arguments: { floor: 'alpha' } });
  const qListStruct = qListRes.structuredContent as { questions: Array<{ id: string; worker: string; deepLink: string }> };
  assert.equal(qListStruct.questions.length, 1);
  const qItem = qListStruct.questions[0]!;
  assert.equal(qItem.deepLink, `${TAILNET_BASE}/open/question/${subId}?floor=alpha&ask=${encodeURIComponent(qItem.id)}`);

  const statusRes = await botClient.callTool({ name: 'team_status', arguments: { floor: 'alpha' } });
  const statusStruct = statusRes.structuredContent as {
    workers: Array<{ id: string; deepLink: string; questionDeepLink?: string }>;
    floorWorkers?: Array<{ id: string; deepLink: string }>;
  };
  const subStatus = statusStruct.workers.find((w) => w.id === subId)!;
  assert.equal(subStatus.deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);
  assert.equal(subStatus.questionDeepLink, qItem.deepLink);

  const reportGetRes = await botClient.callTool({ name: 'team_report_get', arguments: { worker: subId, floor: 'alpha' } });
  assert.equal((reportGetRes.structuredContent as { deepLink: string }).deepLink, `${TAILNET_BASE}/open/question/${subId}?floor=alpha&ask=${encodeURIComponent(qItem.id)}`);

  const waitRes = await botClient.callTool({
    name: 'team_wait',
    arguments: { floor: 'alpha', since: 'team:alpha:0', timeoutSec: 1 },
  });
  const waitStruct = waitRes.structuredContent as { questions: Array<{ id: string; deepLink: string }> };
  assert.equal(waitStruct.questions[0]?.deepLink, qItem.deepLink);

  // Final report + team_review deepLink
  await subClient.callTool({
    name: 'team_report',
    arguments: { text: 'Implemented HTTPS bounce + Android intent handling.' },
  });
  const finalReportRes = await botClient.callTool({ name: 'team_report_get', arguments: { worker: subId, floor: 'alpha' } });
  assert.equal((finalReportRes.structuredContent as { deepLink: string }).deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);
  const reviewRes = await botClient.callTool({
    name: 'team_review',
    arguments: { worker: subId, floor: 'alpha', verdict: 'approve', notes: 'Verified.' },
  });
  assert.equal((reviewRes.structuredContent as { deepLink: string }).deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);

  // 4. Whiteboard tools (whiteboard_card, whiteboard_read, whiteboard_state, whiteboard_marks)
  const createCardRes = await leadClient.callTool({
    name: 'whiteboard_card',
    arguments: { action: 'create', title: 'Deep Link Proof', source: { markdown: '# Proof\n\nAll links verified.' } },
  });
  const cardStruct = createCardRes.structuredContent as { card: string; deepLink: string };
  assert.equal(cardStruct.deepLink, `${TAILNET_BASE}/open/card/${cardStruct.card}?floor=alpha`);

  const readBoardRes = await leadClient.callTool({ name: 'whiteboard_read', arguments: { peek: true } });
  const readBoardStruct = readBoardRes.structuredContent as {
    floorDeepLink: string;
    cards: Array<{ id: string; deepLink: string }>;
  };
  assert.equal(readBoardStruct.floorDeepLink, `${TAILNET_BASE}/open/floor/alpha`);
  assert.equal(readBoardStruct.cards[0]?.deepLink, cardStruct.deepLink);

  const stateRes = await leadClient.callTool({
    name: 'whiteboard_state',
    arguments: { card: cardStruct.card, op: 'set', path: 'verified', value: true },
  });
  assert.equal((stateRes.structuredContent as { deepLink: string }).deepLink, cardStruct.deepLink);

  const markRes = await leadClient.callTool({
    name: 'whiteboard_marks',
    arguments: { card: cardStruct.card, kind: 'sticky', op: 'add', text: 'Looks sharp', box: { x: 40, y: 40, w: 180 } },
  });
  assert.equal((markRes.structuredContent as { deepLink: string }).deepLink, cardStruct.deepLink);

  // 5. Real Grok Bot webhook deliveries carry question and worker deepLink values without leaking secrets.
  assert.ok(webhookDeliveries.length >= 2);
  const questionWebhook = webhookDeliveries.find((d) => d.event === 'question')!;
  assert.ok(questionWebhook);
  assert.equal(questionWebhook.items[0]?.deepLink, qItem.deepLink);
  assert.equal(questionWebhook.items[0]?.worker?.deepLink, `${TAILNET_BASE}/open/worker/${subId}?floor=alpha`);
  assert.doesNotMatch(JSON.stringify(questionWebhook), /whsec_super_secret_token_123456/);
});

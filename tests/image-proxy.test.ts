import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ImageProxy, checkImageUrl, isPrivateAddress } from '../src/server/image-proxy.js';

const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(32)]);

async function serve(t: test.TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('links must be plain http or https without credentials', () => {
  assert.deepEqual(checkImageUrl(' https://example.com/a.png '), { url: 'https://example.com/a.png' });
  for (const bad of ['', 'nope', 'file:///etc/passwd', 'ftp://example.com/a.png', 'https://user:pw@example.com/a.png', `https://example.com/${'a'.repeat(2100)}`]) {
    assert.ok('error' in checkImageUrl(bad), bad);
  }
});

test('private, loopback, link-local and mapped addresses are recognized', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('the office refuses to fetch from its own machine or network', async () => {
  const proxy = new ImageProxy();
  for (const url of ['http://127.0.0.1:1/a.png', 'http://localhost:1/a.png', 'http://[::1]:1/a.png', 'http://169.254.169.254/latest/meta-data', 'http://192.168.0.1/a.png']) {
    const r = await proxy.get(url);
    assert.ok('error' in r && r.status === 400, `${url}: ${JSON.stringify('error' in r ? r : r.type)}`);
  }
});

test('a picture is relayed with its type, cached, and a redirect is followed', async (t) => {
  let hits = 0;
  const base = await serve(t, (req, res) => {
    hits++;
    if (req.url === '/redirect') return void res.writeHead(302, { location: '/a.png' }).end();
    res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
  });
  const proxy = new ImageProxy({ allowPrivate: true });
  const first = await proxy.get(`${base}/redirect`);
  assert.ok(!('error' in first) && first.type === 'image/png' && first.body.equals(PNG));
  const again = await proxy.get(`${base}/redirect`);
  assert.ok(!('error' in again));
  assert.equal(hits, 2);
});

test('a host that does not say gets sniffed, and pages, huge files and failures are refused', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/sniff') return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(PNG);
    if (req.url === '/page') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
    if (req.url === '/text') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('hello');
    if (req.url === '/big') return void res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024) }).end();
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 17; i++) res.write(chunk);
      return void res.end();
    }
    if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
    res.writeHead(404).end();
  });
  const proxy = new ImageProxy({ allowPrivate: true });
  const sniffed = await proxy.get(`${base}/sniff`);
  assert.ok(!('error' in sniffed) && sniffed.type === 'image/png');
  const status = async (p: string) => {
    const r = await proxy.get(`${base}${p}`);
    return 'error' in r ? r.status : 200;
  };
  assert.equal(await status('/page'), 415);
  assert.equal(await status('/text'), 415);
  assert.equal(await status('/big'), 413);
  assert.equal(await status('/stream'), 413);
  assert.equal(await status('/loop'), 502);
  assert.equal(await status('/missing'), 502);
});

test('one deadline covers the whole fetch: a host trickling bytes, or a chain of slow redirects, is cut off', async (t) => {
  const open = new Set<http.ServerResponse>();
  const base = await serve(t, (req, res) => {
    open.add(res);
    res.on('close', () => open.delete(res));
    if (req.url?.startsWith('/hop/')) {
      const n = Number(req.url.slice(5));
      // Each hop answers well inside the deadline; only the sum of them is too long.
      return void setTimeout(() => res.writeHead(302, { location: `/hop/${n + 1}` }).end(), 120);
    }
    if (req.url === '/headers-then-nothing') return void res.writeHead(200, { 'content-type': 'image/png' }).flushHeaders();
    res.writeHead(200, { 'content-type': 'image/png' });
    res.write(PNG);
    // A byte every 25 ms keeps a socket idle timeout from ever firing.
    const timer = setInterval(() => res.write(Buffer.from([0])), 25);
    res.on('close', () => clearInterval(timer));
  });
  t.after(() => {
    for (const res of open) res.destroy();
  });
  const proxy = new ImageProxy({ allowPrivate: true, timeoutMs: 400 });
  for (const url of ['/trickle', '/hop/0', '/headers-then-nothing']) {
    const started = Date.now();
    const r = await proxy.get(`${base}${url}`);
    const took = Date.now() - started;
    assert.ok('error' in r && r.status === 504 && /took too long/.test(r.error), `${url}: ${JSON.stringify('error' in r ? r : r.type)}`);
    assert.ok(took >= 350 && took < 1500, `${url} was cut off after ${took} ms`);
  }
  // A picture that arrives in time is unaffected.
  const fast = await serve(t, (_req, res) => void res.writeHead(200, { 'content-type': 'image/png' }).end(PNG));
  const ok = await proxy.get(`${fast}/a.png`);
  assert.ok(!('error' in ok) && ok.body.equals(PNG));
});

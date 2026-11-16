import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { sniffImage, type ImageResult } from './images.js';

// Replies' Markdown can show a picture from the web. The companions fetch it through the office
// (GET /api/image, signed-in callers only) so a phone never contacts an arbitrary host itself and
// the office can cap what it relays. Because the office fetches on the caller's behalf, it must not
// reach machines the caller couldn't: every address a link resolves to, and every redirect hop, is
// checked, and the connection is made to the address that was checked.

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CACHE_BYTES = 96 * 1024 * 1024;
const CACHE_MS = 30 * 60_000;
/** One deadline for the whole fetch: DNS, every redirect hop and the body. A socket idle timeout would restart with each hop and each trickled byte. */
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const TOO_BIG = 'That image is over 15 MB. Try a smaller one.';

/** Checks a link someone wants shown. Returns the tidied URL, or why it won't do. */
export function checkImageUrl(raw: unknown): { url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a link to an image' };
  if (s.length > 2048) return { error: 'That link is too long' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That isn't a web link. Paste an address that starts with https://" };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links can be shown' };
  if (u.username || u.password) return { error: 'Links with a sign-in in them are not shown' };
  return { url: u.href };
}

/** Whether an IP address is one only this machine or its own network can reach (loopback, private, link-local, CGNAT, multicast, unspecified, metadata). */
export function isPrivateAddress(address: string): boolean {
  let ip = address.toLowerCase();
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (net.isIPv6(ip)) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return ip === '::' || ip === '::1' || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || ip.startsWith('64:ff9b:') || (first === 0x2001 && ip.startsWith('2001:db8:'));
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** A DNS lookup that refuses private addresses, so the socket only ever connects to one that was checked. */
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = (addresses as dns.LookupAddress[]).filter((a) => !isPrivateAddress(a.address));
    if (!list.length) return callback(Object.assign(new Error(`${hostname} is not a public address`), { code: 'EPRIVATE' }), '', 0);
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

type Hop = { status: number; headers: http.IncomingHttpHeaders; res: http.IncomingMessage };

function request(url: URL, allowPrivate: boolean, signal: AbortSignal): Promise<Hop> {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const bare = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(bare) && isPrivateAddress(bare)) return reject(Object.assign(new Error('private'), { code: 'EPRIVATE' }));
    const req = mod.request(
      url,
      {
        method: 'GET',
        ...(allowPrivate ? {} : { lookup: publicLookup }),
        signal,
        headers: {
          accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
          'user-agent': 'Mozilla/5.0 (compatible; factory-flow; +https://github.com/nikships/factory-flow)',
        },
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, res }),
    );
    req.on('error', reject);
    req.end();
  });
}

export class ImageProxy {
  private cache = new Map<string, { type: string; body: Buffer; at: number }>();
  private bytes = 0;
  private inflight = new Map<string, Promise<ImageResult>>();

  /** `allowPrivate` and `timeoutMs` exist for tests that serve a picture from loopback or need a short deadline; the office sets neither. */
  constructor(private readonly opts: { allowPrivate?: boolean; timeoutMs?: number } = {}) {}

  get(raw: string): Promise<ImageResult> {
    const checked = checkImageUrl(raw);
    if ('error' in checked) return Promise.resolve({ status: 400, error: checked.error });
    const url = checked.url;
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      this.cache.delete(url);
      this.cache.set(url, hit);
      return Promise.resolve(hit);
    }
    let p = this.inflight.get(url);
    if (!p) {
      p = this.fetch(url).finally(() => this.inflight.delete(url));
      this.inflight.set(url, p);
    }
    return p;
  }

  private async fetch(start: string): Promise<ImageResult> {
    let url = new URL(start);
    let hop: Hop | undefined;
    const signal = AbortSignal.timeout(this.opts.timeoutMs ?? TIMEOUT_MS);
    const tooSlow = (host: string): ImageResult => ({ status: 504, error: `${host} took too long to answer` });
    for (let i = 0; ; i++) {
      const host = url.host;
      try {
        hop = await request(url, this.opts.allowPrivate === true, signal);
      } catch (err) {
        if (signal.aborted) return tooSlow(host);
        const code = (err as { code?: string }).code;
        if (code === 'EPRIVATE') return { status: 400, error: `${host} is not a public web address` };
        return { status: 502, error: `Couldn't reach ${host}${code ? ` (${code})` : ''}` };
      }
      if (hop.status >= 300 && hop.status < 400 && hop.headers.location) {
        hop.res.destroy();
        if (i >= MAX_REDIRECTS) return { status: 502, error: `${host} redirected too many times` };
        const next = checkImageUrl(new URL(hop.headers.location, url).href);
        if ('error' in next) return { status: 502, error: `${host} redirected somewhere that isn't a web link` };
        url = new URL(next.url);
        continue;
      }
      break;
    }
    const { res, headers, status } = hop;
    const host = url.host;
    if (status < 200 || status >= 300) {
      res.destroy();
      return { status: 502, error: `${host} answered ${status}${res.statusMessage ? ` ${res.statusMessage}` : ''}` };
    }
    let type = String(headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type === 'text/html' || type === 'application/xhtml+xml') {
      res.destroy();
      return { status: 415, error: 'That link is a web page, not an image.' };
    }
    if (Number(headers['content-length']) > MAX_IMAGE_BYTES) {
      res.destroy();
      return { status: 413, error: TOO_BIG };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const expire = () => res.destroy();
    signal.addEventListener('abort', expire, { once: true });
    try {
      for await (const chunk of res) {
        size += (chunk as Buffer).length;
        if (size > MAX_IMAGE_BYTES) {
          res.destroy();
          return { status: 413, error: TOO_BIG };
        }
        chunks.push(chunk as Buffer);
      }
    } catch {
      return signal.aborted ? tooSlow(host) : { status: 502, error: `${host} stopped sending the image halfway` };
    } finally {
      signal.removeEventListener('abort', expire);
    }
    if (signal.aborted) return tooSlow(host);
    const body = Buffer.concat(chunks);
    if (!type.startsWith('image/')) {
      const sniffed = sniffImage(body);
      if (!sniffed) return { status: 415, error: `That link isn't an image${type ? ` (it's ${type})` : ''}` };
      type = sniffed;
    }
    const entry = { type, body, at: Date.now() };
    const old = this.cache.get(start);
    if (old) this.bytes -= old.body.length;
    this.cache.delete(start);
    this.cache.set(start, entry);
    this.bytes += body.length;
    for (const [k, v] of this.cache) {
      if (this.bytes <= CACHE_BYTES) break;
      this.cache.delete(k);
      this.bytes -= v.body.length;
    }
    return entry;
  }
}

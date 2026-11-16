// Public deep links open the Android app or web companion without disclosing office state.
import type http from 'node:http';
import { appDeepLink, normalizeDeepLinkBase, parseDeepLink, type DeepLinkTarget } from '../shared/deep-links.js';
import { COMPANION_PATH } from '../shared/devices.js';

export function companionHref(target: DeepLinkTarget): string {
  const params = new URLSearchParams();
  if (target.floorId) params.set('floor', target.floorId);
  if (target.kind === 'worker' || target.kind === 'question') {
    params.set('worker', target.workerId);
    if (target.kind === 'question' || target.view === 'thread') params.set('view', 'thread');
  } else if (target.kind === 'card') params.set('card', target.cardId);
  return `${COMPANION_PATH}#${params}`;
}

const HOST_HEADER_RE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

function requestOrigin(req: http.IncomingMessage, scheme: 'http' | 'https', fallbackBase?: string): string | undefined {
  const host = typeof req.headers.host === 'string' ? req.headers.host.trim() : '';
  if (host && HOST_HEADER_RE.test(host)) {
    const candidate = normalizeDeepLinkBase(`${scheme}://${host}`);
    if (candidate) return candidate;
  }
  return normalizeDeepLinkBase(fallbackBase);
}

export function serveDeepLinkBounce(req: http.IncomingMessage, res: http.ServerResponse, rawUrl: string, scheme: 'http' | 'https', fallbackBase?: string): void {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...headers, allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const base = requestOrigin(req, scheme, fallbackBase) ?? 'http://invalid.local';
  const parsed = parseDeepLink(`${base}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`);
  if (!parsed) {
    res.writeHead(404, headers);
    res.end('Invalid Factory Flow link.');
    return;
  }
  let location = companionHref(parsed.target);
  if (/\bAndroid\b/i.test(String(req.headers['user-agent'] ?? ''))) {
    const app = new URL(appDeepLink(parsed.target, { base: parsed.officeBase, office: parsed.officeId }));
    const appScheme = app.protocol.slice(0, -1);
    app.protocol = 'intent:';
    const fallbackUrl = new URL(location, base).href;
    location = `${app.href}#Intent;scheme=${appScheme};package=ai.factory.factoryflow;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
  }
  res.writeHead(302, { ...headers, location });
  res.end();
}

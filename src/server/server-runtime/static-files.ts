import type http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export function createStaticFiles(publicDir: string) {
  /**
   * `immutable` is only for content-hashed names. `revalidate` is for files whose name stays put while
   * their bytes change between releases: the browser keeps them but asks each load, and gets a 304.
   */
  const serveFile = (res: http.ServerResponse, file: string, cache: boolean | 'revalidate', req?: http.IncomingMessage) => {
    const ext = path.extname(file);
    const headers: http.OutgoingHttpHeaders = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cache === 'revalidate' ? 'no-cache' : cache ? 'public, max-age=31536000, immutable' : 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    };
    if (cache === 'revalidate') {
      const st = statSync(file);
      headers.etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      if (req?.headers['if-none-match'] === headers.etag) {
        res.writeHead(304, headers).end();
        return;
      }
    }
    res.writeHead(200, headers);
    createReadStream(file)
      .on('error', (err) => res.destroy(err))
      .pipe(res);
  };

  /** A file of the client bundle, or undefined when it's missing, a folder, or outside the bundle. */
  const publicFile = (p: string): string | undefined => {
    const file = path.resolve(publicDir, `.${p.startsWith('/') ? p : `/${p}`}`);
    if (!file.startsWith(`${path.resolve(publicDir)}${path.sep}`)) return undefined;
    try {
      return statSync(file).isFile() ? file : undefined;
    } catch {
      return undefined;
    }
  };
  return { serveFile, publicFile };
}

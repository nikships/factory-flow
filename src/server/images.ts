/** Image bytes returned by file, docs and integration endpoints. */
export type ImageResult = { type: string; body: Buffer } | { status: number; error: string };

/** Recognizes common image formats from their first bytes, for hosts that don't say. */
export function sniffImage(b: Buffer): string | undefined {
  const at = (i: number, s: string) => b.subarray(i, i + s.length).toString('latin1') === s;
  if (at(0, '\x89PNG')) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftypavif') || at(4, 'ftypavis')) return 'image/avif';
  if (at(0, 'BM')) return 'image/bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  const head = b.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return undefined;
}

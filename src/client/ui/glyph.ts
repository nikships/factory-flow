/** Plain-text model label without the DroidProxy prefix. */
export function withoutGlyph(text: string): string {
  return text.replace(/droidproxy:?\s*/gi, '');
}

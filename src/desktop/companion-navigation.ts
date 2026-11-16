/** Only the companion itself may replace the trusted window. External web links go to a browser. */
export function companionNavigation(raw: string, officeUrl: string): 'allow' | 'external' | 'deny' {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return 'deny';
    if (url.origin === new URL(officeUrl).origin) return url.pathname === '/dashboard' && !url.search ? 'allow' : 'deny';
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? 'external' : 'deny';
  } catch {
    return 'deny';
  }
}

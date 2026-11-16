// Worker, floor and Whiteboard links opened by the companion and the Mac app.

export interface WorkerLink {
  worker: string;
  floor?: string;
  view?: 'thread';
}

const ID_MAX = 200;

/** The worker a page's address asks to open, if it asks for one. */
export function parseWorkerLink(hash: string): WorkerLink | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const worker = params.get('worker')?.trim();
  if (!worker || worker.length > ID_MAX) return undefined;
  const floor = params.get('floor')?.trim();
  return { worker, ...(floor && floor.length <= ID_MAX ? { floor } : {}), ...(params.get('view') === 'thread' ? { view: 'thread' as const } : {}) };
}

/** Where the office is now, for a link to act on. */
export interface LinkPlace {
  floor: string | null;
  hasWorker: (id: string) => boolean;
  hasFloor: (id: string) => boolean;
}

/** Open the terminal here, go to the worker's floor first, or say it's gone (sent home, or its floor left the building). */
export function linkStep(link: WorkerLink, here: LinkPlace): 'open' | 'go' | 'gone' {
  if (here.hasWorker(link.worker)) return 'open';
  if (link.floor && link.floor !== here.floor && here.hasFloor(link.floor)) return 'go';
  return 'gone';
}

/** A floor or card link, separate from the worker navigation state. */
export function parsePlaceLink(hash: string): { floor?: string; card?: string } | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.has('worker')) return undefined;
  const valid = (value: string | null) => (value && /^[A-Za-z0-9_\-:.]{1,128}$/.test(value) ? value : undefined);
  const floor = valid(params.get('floor'));
  const card = valid(params.get('card'));
  return floor || card ? { ...(floor ? { floor } : {}), ...(card ? { card } : {}) } : undefined;
}

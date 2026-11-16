// Stable worker slots shared by the companions and server. Existing ids survive the scene removal.
export interface DeskDef {
  id: string;
  label: string;
}
export const DESKS: DeskDef[] = Array.from({ length: 16 }, (_, i) => ({ id: `desk-${i + 1}`, label: `Desk ${i + 1}` }));
export const BEANBAGS: DeskDef[] = Array.from({ length: 12 }, (_, i) => ({ id: `beanbag-${i + 1}`, label: `Overflow ${i + 1}` }));
export const SEATS: DeskDef[] = [...DESKS, ...BEANBAGS];
export const DESK_BY_ID = new Map(SEATS.map((d) => [d.id, d]));
export function nextFreeSeat(taken: (id: string) => boolean): DeskDef | undefined {
  return SEATS.find((d) => !taken(d.id));
}
/** Prefer an available numbered desk near the lead, then overflow. */
export function nearestFreeSeat(source: string, taken: (id: string) => boolean): DeskDef | undefined {
  const at = SEATS.findIndex((d) => d.id === source);
  const free = DESKS.filter((d) => !taken(d.id));
  return (free.length ? free : SEATS.filter((d) => !taken(d.id))).sort((a, b) => Math.abs(SEATS.indexOf(a) - at) - Math.abs(SEATS.indexOf(b) - at))[0];
}

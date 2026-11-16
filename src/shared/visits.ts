// Peer message delivery, with no scene movement or animation.
export type VisitKind = 'tell' | 'ask' | 'handoff';
export type VisitPhase = 'queued';
export interface Visit {
  id: string;
  visitor: string;
  host: string;
  kind: VisitKind;
  phase: VisitPhase;
  since: number;
}
export const VISIT_KINDS: readonly VisitKind[] = ['tell', 'ask', 'handoff'];

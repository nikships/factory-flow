import type { Run, ScreenPlacement } from '../shared/protocol';

export interface ScreenBitmap {
  source: CanvasImageSource;
  width: number;
  height: number;
  sig?: string;
}

export interface ScreenState {
  cols: number;
  rows: number;
  lines: Run[][];
  /** Scrollback rows just above the screen, oldest first, for a terminal wider than the preview. */
  above?: Run[][];
  placements?: ScreenPlacement[];
  bitmaps?: Map<number, ScreenBitmap>;
  cursor: [number, number];
  version: number;
}

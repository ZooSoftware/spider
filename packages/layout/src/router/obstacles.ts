// Spatial index over obstacle boxes and the collision checker built on it.
import type { Rect } from "../geometry.ts";
import { ROUTE_MARGIN } from "./types.ts";

/** Uniform-grid spatial index over obstacle boxes (registered with ROUTE_MARGIN inflation). */
export class ObstacleIndex {
  private static readonly CELL = 160;
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private tick = 0;
  constructor(readonly rects: Rect[]) {
    this.stamp = new Uint32Array(rects.length);
    rects.forEach((r, i) => {
      this.cellsOf(r.x - ROUTE_MARGIN, r.y - ROUTE_MARGIN, r.x + r.w + ROUTE_MARGIN, r.y + r.h + ROUTE_MARGIN, (k) => {
        const l = this.cells.get(k);
        if (l) l.push(i);
        else this.cells.set(k, [i]);
      });
    });
  }
  private cellsOf(x1: number, y1: number, x2: number, y2: number, fn: (key: number) => boolean | void): boolean {
    const C = ObstacleIndex.CELL;
    const cx1 = Math.floor(x1 / C), cx2 = Math.floor(x2 / C), cy1 = Math.floor(y1 / C), cy2 = Math.floor(y2 / C);
    for (let cx = cx1; cx <= cx2; cx++) for (let cy = cy1; cy <= cy2; cy++) if (fn((cx + 32768) * 65536 + (cy + 32768))) return true;
    return false;
  }
  /** Calls `fn` once per obstacle whose cells meet the query box; stops when `fn` returns true. */
  some(x1: number, y1: number, x2: number, y2: number, fn: (i: number) => boolean): boolean {
    const t = ++this.tick;
    if (t === 0xffffffff) { this.stamp.fill(0); this.tick = 1; }
    return this.cellsOf(x1, y1, x2, y2, (k) => {
      const l = this.cells.get(k);
      if (!l) return false;
      for (const i of l) {
        if (this.stamp[i] === this.tick) continue;
        this.stamp[i] = this.tick;
        if (fn(i)) return true;
      }
      return false;
    });
  }
}

export interface Checker {
  idx: ObstacleIndex;
  excluded: Set<number>;
  margin: number;
  src?: Rect;
  tgt?: Rect;
}

/** Obstacle rects (inflated by the checker margin) meeting a window; plus src/tgt boxes. */
export function rectsIn(c: Checker, w: Rect): Rect[] {
  const out: Rect[] = [];
  const m = c.margin;
  c.idx.some(w.x, w.y, w.x + w.w, w.y + w.h, (i) => {
    if (c.excluded.has(i)) return false;
    const r = c.idx.rects[i]!;
    if (r.x - m < w.x + w.w && r.x + r.w + m > w.x && r.y - m < w.y + w.h && r.y + r.h + m > w.y) {
      out.push({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
    }
    return false;
  });
  if (c.src) out.push(c.src);
  if (c.tgt) out.push(c.tgt);
  return out;
}

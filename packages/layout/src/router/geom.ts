// Small geometry helpers for ports, segments and route costs.
import type { Side } from "@spider/profile-schema";
import type { Rect } from "../geometry.ts";
import type { Point } from "../layout-file.ts";
import { BEND, DX, DY, type Dir, type End, FACING, type NodeInfo, SIDE_DIR, opp } from "./types.ts";
import type { Checker } from "./obstacles.ts";

/** [lo, hi, fixed] of the port range on a side. */
export function sideRange(n: NodeInfo, side: Side): [number, number, number] {
  const { box, shape } = n;
  switch (side) {
    case "right": return [shape.y, shape.y + shape.h, box.x + box.w];
    case "left": return [shape.y, shape.y + shape.h, box.x];
    case "top": return [box.x, box.x + box.w, box.y];
    case "bottom": return [box.x, box.x + box.w, box.y + box.h];
  }
}

export function sidePoint(n: NodeInfo, side: Side, along?: number): Point {
  const [lo, hi, fixed] = sideRange(n, side);
  const a = along ?? Math.round((lo + hi) / 2);
  return side === "left" || side === "right" ? [fixed, a] : [a, fixed];
}

/** Direction of the stub leaving the endpoint. */
export function stubDir(e: End): Dir {
  const d = SIDE_DIR[e.side];
  return e.inward ? opp(d) : d;
}

export function step(p: Point, d: Dir, len: number): Point {
  return [p[0] + DX[d] * len, p[1] + DY[d] * len];
}

export function segHits(p: Point, q: Point, r: Rect): boolean {
  const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]);
  const y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
  if (y1 === y2) return y1 > r.y && y1 < r.y + r.h && x2 > r.x && x1 < r.x + r.w;
  return x1 > r.x && x1 < r.x + r.w && y2 > r.y && y1 < r.y + r.h;
}

export function segClear(c: Checker, p: Point, q: Point, first: boolean, last: boolean): boolean {
  const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]);
  const y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
  const m = c.margin;
  const hit = c.idx.some(x1, y1, x2, y2, (i) => {
    if (c.excluded.has(i)) return false;
    const r = c.idx.rects[i]!;
    const rx = r.x - m, ry = r.y - m, rx2 = r.x + r.w + m, ry2 = r.y + r.h + m;
    return y1 === y2 ? y1 > ry && y1 < ry2 && x2 > rx && x1 < rx2 : x1 > rx && x1 < rx2 && y2 > ry && y1 < ry2;
  });
  if (hit) return false;
  if (c.src && !first && segHits(p, q, c.src)) return false;
  if (c.tgt && !last && segHits(p, q, c.tgt)) return false;
  return true;
}

export function pathClear(c: Checker, pts: Point[]): boolean {
  for (let i = 0; i + 1 < pts.length; i++) if (!segClear(c, pts[i]!, pts[i + 1]!, i === 0, i === pts.length - 2)) return false;
  return true;
}

/** Drop duplicate points and merge collinear runs. Returns null if the path doubles back. */
export function normalize(pts: Point[]): Point[] | null {
  const out: Point[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && l[0] === p[0] && l[1] === p[1]) continue;
    const q = out[out.length - 2];
    if (l && q && ((q[0] === l[0] && l[0] === p[0]) || (q[1] === l[1] && l[1] === p[1]))) {
      const d1 = Math.sign(l[0] - q[0]) + 2 * Math.sign(l[1] - q[1]);
      const d2 = Math.sign(p[0] - l[0]) + 2 * Math.sign(p[1] - l[1]);
      if (d1 !== d2) return null;
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

export function pathCost(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.abs(pts[i + 1]![0] - pts[i]![0]) + Math.abs(pts[i + 1]![1] - pts[i]![1]);
  return len + BEND * Math.max(0, pts.length - 2);
}

/** Penalty for sides that do not face the other endpoint, and for bottom ports under labels. */
export function sidePenalty(e: End, other: End): number {
  let p = e.side === "bottom" && e.node.labelBelow ? BEND * 2 : 0;
  if (!e.inward && !other.inward) {
    const a = e.node.box, b = other.node.box;
    const vx = b.x + b.w / 2 - (a.x + a.w / 2), vy = b.y + b.h / 2 - (a.y + a.h / 2);
    const len = Math.hypot(vx, vy);
    const d = SIDE_DIR[e.side];
    if (len > 0) p += FACING * (1 - (DX[d] * vx + DY[d] * vy) / len);
  }
  return p;
}

/** Lower bound on bends between stub points a (moving d0) and b (arriving moving arr). */
export function minBends(a: Point, d0: Dir, b: Point, arr: Dir): number {
  if (d0 === arr) {
    const ahead = (b[0] - a[0]) * DX[d0] + (b[1] - a[1]) * DY[d0] >= 0;
    const aligned = d0 % 2 === 0 ? a[1] === b[1] : a[0] === b[0];
    return ahead && aligned ? 0 : 2;
  }
  return d0 === opp(arr) ? 2 : 1;
}

// Manual line editing (editor gestures), kept pure so it can be tested: move a segment
// sideways, slide a line end along its node side, find which side a point is on.
import type { Side } from "@spider/profile-schema";
import type { Rect } from "./geometry.ts";
import type { Point } from "./layout-file.ts";

/** Keep line ends away from node corners. */
const CORNER_GAP = 6;

/** 0 if the segment is vertical (moves along x), 1 if horizontal (moves along y). */
export function segmentNormalAxis(a: Point, b: Point): 0 | 1 {
  return a[0] === b[0] ? 0 : 1;
}

/** Side of `box` that point `p` lies on (or is closest to). */
export function sideOf(box: Rect, p: Point): Side {
  const d: [Side, number][] = [
    ["left", Math.abs(p[0] - box.x)],
    ["right", Math.abs(p[0] - (box.x + box.w))],
    ["top", Math.abs(p[1] - box.y)],
    ["bottom", Math.abs(p[1] - (box.y + box.h))],
  ];
  d.sort((u, v) => u[1] - v[1]);
  return d[0]![0];
}

/** Allowed range along a side for a line end ([lo, hi] on the axis running along the side). */
function sideRange(box: Rect, side: Side): [number, number] {
  return side === "left" || side === "right"
    ? [box.y + CORNER_GAP, box.y + box.h - CORNER_GAP]
    : [box.x + CORNER_GAP, box.x + box.w - CORNER_GAP];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Move segment `k` (points k → k+1) sideways to coordinate `to`. Interior segments move
 * freely and their neighbours stretch; an end segment slides its line end along the node side
 * (clamped to that side); a single straight segment slides both ends.
 */
export function moveSegment(points: Point[], k: number, to: number, source: Rect, target: Rect): Point[] {
  const pts = points.map((p) => [p[0], p[1]] as Point);
  const n = pts.length;
  if (k < 0 || k + 1 >= n) return pts;
  const ax = segmentNormalAxis(pts[k]!, pts[k + 1]!);
  let v = Math.round(to);
  if (k === 0) {
    const [lo, hi] = sideRange(source, sideOf(source, pts[0]!));
    v = clamp(v, lo, hi);
  }
  if (k + 1 === n - 1) {
    const [lo, hi] = sideRange(target, sideOf(target, pts[n - 1]!));
    v = clamp(v, lo, hi);
  }
  pts[k]![ax] = v;
  pts[k + 1]![ax] = v;
  return dedupe(pts);
}

/** Drop repeated points and merge collinear runs (keeps the route orthogonal and minimal). */
export function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && l[0] === p[0] && l[1] === p[1]) continue;
    const q = out[out.length - 2];
    if (l && q && ((q[0] === l[0] && l[0] === p[0]) || (q[1] === l[1] && l[1] === p[1]))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Middle of the longest segment: where the edge label goes. */
export function edgeLabelPos(pts: Point[]): Point | undefined {
  let best = -1;
  let at: Point | undefined;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
    if (len > best) {
      best = len;
      at = [Math.round((p[0] + q[0]) / 2), Math.round((p[1] + q[1]) / 2)];
    }
  }
  return at;
}

/** True when every segment is horizontal or vertical. */
export function isOrthogonal(pts: Point[]): boolean {
  return pts.every((p, i) => i === 0 || p[0] === pts[i - 1]![0] || p[1] === pts[i - 1]![1]);
}

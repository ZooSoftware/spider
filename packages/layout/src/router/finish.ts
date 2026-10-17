// Self loops, re-snapped manual routes and the EdgeLayout output.
import type { ModelEdge } from "@spider/core";
import type { Side } from "@spider/profile-schema";
import type { Rect } from "../geometry.ts";
import type { EdgeLayout, Point } from "../layout-file.ts";
import { ARROW_STUB, type Job, type NodeInfo } from "./types.ts";
import { normalize, segHits, sidePoint } from "./geom.ts";

export const CORNERS: [Side, Side][] = [["top", "right"], ["right", "bottom"], ["bottom", "left"], ["left", "top"]];

export function loopPoints(box: Rect, corner: Side, i: number): Point[] {
  const { x, y, w, h } = box;
  const q = Math.round(Math.min(w, h) / 4) + i * 6;
  const L = ARROW_STUB + i * 10;
  const r = x + w, b = y + h;
  switch (corner) {
    case "top": return [[r - q, y], [r - q, y - L], [r + L, y - L], [r + L, y + q], [r, y + q]];
    case "right": return [[r, b - q], [r + L, b - q], [r + L, b + L], [r - q, b + L], [r - q, b]];
    case "bottom": return [[x + q, b], [x + q, b + L], [x - L, b + L], [x - L, b - q], [x, b - q]];
    default: return [[x, y + q], [x - L, y + q], [x - L, y - L], [x + q, y - L], [x + q, y]];
  }
}

/** Small loop around the least busy corner (port load, crossing routes, labels, kind ports). */
export function selfLoop(n: NodeInfo, i: number, load: (s: Side) => number, jobs: Job[]): Point[] {
  const allowed = (c: [Side, Side]): boolean => !n.ports || (n.ports.includes(c[0]) && n.ports.includes(c[1]));
  const cands = CORNERS.some(allowed) ? CORNERS.filter(allowed) : CORNERS;
  let best: Point[] = [], bestScore = Infinity;
  for (const c of cands) {
    const pts = loopPoints(n.box, c[0], i);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const area: Rect = { x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, w: 0, h: 0 };
    area.w = Math.max(...xs) + 4 - area.x;
    area.h = Math.max(...ys) + 4 - area.y;
    let hits = 0;
    for (const j of jobs) for (let k = 0; k + 1 < j.pts.length; k++) if (segHits(j.pts[k]!, j.pts[k + 1]!, area)) hits++;
    const score = 10 * (load(c[0]) + load(c[1])) + 25 * hits + (n.labelBelow && c.includes("bottom") ? 100 : 0);
    if (score < bestScore) { bestScore = score; best = pts; }
  }
  return best;
}

export function onBoundary(p: Point, r: Rect): boolean {
  const eps = 0.5;
  const inX = p[0] >= r.x - eps && p[0] <= r.x + r.w + eps;
  const inY = p[1] >= r.y - eps && p[1] <= r.y + r.h + eps;
  return (inY && (Math.abs(p[0] - r.x) <= eps || Math.abs(p[0] - r.x - r.w) <= eps)) ||
    (inX && (Math.abs(p[1] - r.y) <= eps || Math.abs(p[1] - r.y - r.h) <= eps));
}

/** Move an endpoint onto the box boundary toward its neighbor point, keeping orthogonality. */
export function snapEnd(r: Rect, toward: Point): Point[] {
  const [px, py] = toward;
  const cx = Math.min(Math.max(px, r.x), r.x + r.w), cy = Math.min(Math.max(py, r.y), r.y + r.h);
  if (py >= r.y && py <= r.y + r.h) return [[px < r.x + r.w / 2 ? r.x : r.x + r.w, py]];
  if (px >= r.x && px <= r.x + r.w) return [[px, py < r.y + r.h / 2 ? r.y : r.y + r.h]];
  // Diagonal region: leave from the middle of the facing side with one extra bend.
  const vertSide = Math.abs(px - cx) >= Math.abs(py - cy);
  if (vertSide) {
    const e: Point = [cx, Math.round(r.y + r.h / 2)];
    return [e, [px, e[1]]];
  }
  const e: Point = [Math.round(r.x + r.w / 2), cy];
  return [e, [e[0], py]];
}

export function resnapManual(prev: EdgeLayout, s: NodeInfo, t: NodeInfo): Point[] {
  const pts = prev.points.map((p) => [p[0], p[1]] as Point);
  if (pts.length >= 3) {
    if (!onBoundary(pts[0]!, s.box)) pts.splice(0, 1, ...snapEnd(s.box, pts[1]!));
    const n = pts.length;
    if (!onBoundary(pts[n - 1]!, t.box)) pts.splice(n - 1, 1, ...snapEnd(t.box, pts[n - 2]!).reverse());
  } else {
    if (!onBoundary(pts[0]!, s.box)) pts[0] = sidePoint(s, "right");
    if (!onBoundary(pts[1]!, t.box)) pts[1] = sidePoint(t, "left");
  }
  return normalize(pts) ?? pts;
}

export function labelPoint(pts: Point[]): Point | undefined {
  let best = -1, at: Point | undefined;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
    if (len > best) { best = len; at = [Math.round((p[0] + q[0]) / 2), Math.round((p[1] + q[1]) / 2)]; }
  }
  return at;
}

export function finish(e: ModelEdge, pts: Point[], prev: EdgeLayout | undefined, manual: boolean): EdgeLayout {
  const points = pts.map((p) => [Math.round(p[0]), Math.round(p[1])] as Point);
  const out: EdgeLayout = { points };
  if (manual) out.manual = true;
  if (prev?.sourcePort) out.sourcePort = prev.sourcePort;
  if (prev?.targetPort) out.targetPort = prev.targetPort;
  if (e.label) {
    const lp = labelPoint(points);
    if (lp) out.labelPos = lp;
  }
  return out;
}

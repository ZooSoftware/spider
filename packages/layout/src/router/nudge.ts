// Spread overlapping collinear segments of different edges apart.
import type { Point } from "../layout-file.ts";
import { type Job, SEP } from "./types.ts";
import { segClear } from "./geom.ts";

export interface Seg {
  job: Job;
  k: number;
  /** Placement axis index: 0 = x (vertical segment), 1 = y (horizontal segment). */
  ax: 0 | 1;
  c: number;
  s0: number;
  s1: number;
  lo: number;
  hi: number;
  sIn: number;
  sOut: number;
}

/** Number of crossings caused by placing `a` before (lower coordinate than) `b`. */
export function crossings(a: Seg, b: Seg): number {
  const inside = (v: number, s: Seg): boolean => v > s.lo && v < s.hi;
  let n = 0;
  if (b.sIn > 0 && inside(b.s0, a)) n++;
  if (b.sOut < 0 && inside(b.s1, a)) n++;
  if (a.sIn < 0 && inside(a.s0, b)) n++;
  if (a.sOut > 0 && inside(a.s1, b)) n++;
  return n;
}

export function collectSegs(jobs: Job[], ax: 0 | 1): Seg[] {
  const segs: Seg[] = [];
  const al = (1 - ax) as 0 | 1;
  for (const job of jobs) {
    const P = job.pts;
    for (let k = 1; k + 2 < P.length; k++) {
      const p = P[k]!, q = P[k + 1]!;
      if (p[ax] !== q[ax]) continue;
      segs.push({
        job, k, ax, c: p[ax], s0: p[al], s1: q[al],
        lo: Math.min(p[al], q[al]), hi: Math.max(p[al], q[al]),
        sIn: Math.sign(p[ax] - P[k - 1]![ax]), sOut: Math.sign(P[k + 2]![ax] - q[ax]),
      });
    }
  }
  return segs;
}

export function nudge(jobs: Job[]): void {
  for (const ax of [0, 1] as const) {
    const list = collectSegs(jobs, ax).sort((u, v) => u.c - v.c || u.job.index - v.job.index || u.k - v.k);
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length && list[k]!.c - list[i]!.c < SEP; k++) {
        const u = list[i]!, v = list[k]!;
        if (Math.min(u.hi, v.hi) - Math.max(u.lo, v.lo) > 0) parent[find(k)] = find(i);
      }
    }
    const groups = new Map<number, Seg[]>();
    list.forEach((s, i) => {
      const r = find(i);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = []));
      g.push(s);
    });
    for (const g of groups.values()) if (g.length > 1) spread(g);
  }
}

export function spread(g: Seg[]): void {
  // Insertion sort by pairwise crossing count (small groups), ties keep (c, job) order.
  const order: Seg[] = [];
  for (const s of g) {
    let i = order.length;
    while (i > 0 && crossings(order[i - 1]!, s) > crossings(s, order[i - 1]!)) i--;
    order.splice(i, 0, s);
  }
  const center = Math.round(g.reduce((a, s) => a + s.c, 0) / g.length);
  const m = order.length;
  const half = (SEP * (m - 1)) / 2;
  const at = (i: number, shift: number): number => Math.round(center + shift + i * SEP - half);
  // Shift the whole bundle if the centered placement is blocked on one side.
  for (const shift of [0, -half, half, -2 * half, 2 * half, -3 * half, 3 * half]) {
    const moved = order.map((s, i) => tryMove(s, at(i, shift)));
    if (moved.every((x) => x !== null)) {
      order.forEach((s, i) => apply(s, moved[i]!, at(i, shift)));
      return;
    }
    if (half === 0) break;
  }
  order.forEach((s, i) => {
    const r = tryMove(s, at(i, 0));
    if (r) apply(s, r, at(i, 0));
  });
}

/** New end points of segment `s` moved to coordinate `nc`, or null if that breaks the route. */
export function tryMove(s: Seg, nc: number): [Point, Point] | null {
  const P = s.job.pts;
  const ax = s.ax;
  const before = P[s.k - 1]![ax], after = P[s.k + 2]![ax];
  if (Math.sign(nc - before) !== s.sIn || Math.sign(after - nc) !== s.sOut) return null;
  // Never shorten an end segment below its stub (keeps arrowheads off bends).
  if (s.k - 1 === 0 && Math.abs(nc - before) < s.job.s.stub) return null;
  if (s.k + 2 === P.length - 1 && Math.abs(after - nc) < s.job.t.stub) return null;
  const p: Point = [P[s.k]![0], P[s.k]![1]], q: Point = [P[s.k + 1]![0], P[s.k + 1]![1]];
  p[ax] = nc; q[ax] = nc;
  const c = s.job.checker;
  const ok = segClear(c, P[s.k - 1]!, p, s.k - 1 === 0, false) && segClear(c, p, q, false, false) &&
    segClear(c, q, P[s.k + 2]!, false, s.k + 2 === P.length - 1);
  return ok ? [p, q] : null;
}

export function apply(s: Seg, pq: [Point, Point], nc: number): void {
  s.job.pts[s.k] = pq[0];
  s.job.pts[s.k + 1] = pq[1];
  s.c = nc;
}

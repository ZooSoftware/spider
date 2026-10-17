// A* fallback over a sparse orthogonal grid when no candidate shape is clear.
import type { Rect } from "../geometry.ts";
import type { Point } from "../layout-file.ts";
import { BEND, DX, DY, type Dir, opp } from "./types.ts";
import { type Checker, rectsIn } from "./obstacles.ts";
import { normalize, step } from "./geom.ts";

export class Heap {
  private f: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.f.length;
  }
  push(f: number, v: number): void {
    const F = this.f, V = this.v;
    let i = F.length;
    F.push(f); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p]! < f || (F[p] === f && V[p]! <= v)) break;
      F[i] = F[p]!; V[i] = V[p]!; i = p;
    }
    F[i] = f; V[i] = v;
  }
  pop(): [number, number] {
    const F = this.f, V = this.v;
    const top: [number, number] = [F[0]!, V[0]!];
    const lf = F.pop()!, lv = V.pop()!;
    const n = F.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (F[c + 1]! < F[c]! || (F[c + 1] === F[c] && V[c + 1]! < V[c]!))) c++;
        if (F[c]! > lf || (F[c] === lf && V[c]! >= lv)) break;
        F[i] = F[c]!; V[i] = V[c]!; i = c;
      }
      F[i] = lf; V[i] = lv;
    }
    return top;
  }
}

export function sortedCoords(vals: Iterable<number>, lo: number, hi: number): number[] {
  const base = [...new Set([...vals].filter((v) => v >= lo && v <= hi))].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < base.length; i++) {
    out.push(base[i]!);
    const n = base[i + 1];
    if (n !== undefined && n - base[i]! > 2) out.push(Math.round((base[i]! + n) / 2));
  }
  return out;
}

export function astar(p0: Point, d0: Dir, l0: number, p1: Point, d1: Dir, l1: number, c: Checker, window: Rect): Point[] | null {
  const a = step(p0, d0, l0), b = step(p1, d1, l1);
  const arr = opp(d1);
  const wx2 = window.x + window.w, wy2 = window.y + window.h;
  const rects = rectsIn(c, window);
  const xs = sortedCoords([a[0], b[0], window.x, wx2, ...rects.flatMap((r) => [r.x, r.x + r.w])], window.x, wx2);
  const ys = sortedCoords([a[1], b[1], window.y, wy2, ...rects.flatMap((r) => [r.y, r.y + r.h])], window.y, wy2);
  const ny = ys.length;
  const ia = xs.indexOf(a[0]) * ny + ys.indexOf(a[1]);
  const ib = xs.indexOf(b[0]) * ny + ys.indexOf(b[1]);
  if (ia < 0 || ib < 0) return null;
  const inside = (x: number, y: number): boolean => {
    for (const r of rects) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    return false;
  };
  const vBlocked = new Map<number, boolean>();
  const blockedV = (v: number): boolean => {
    let r = vBlocked.get(v);
    if (r === undefined) {
      r = v !== ia && v !== ib && inside(xs[Math.floor(v / ny)]!, ys[v % ny]!);
      vBlocked.set(v, r);
    }
    return r;
  };
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new Heap();
  const h = (v: number): number => Math.abs(xs[Math.floor(v / ny)]! - b[0]) + Math.abs(ys[v % ny]! - b[1]);
  const s0 = ia * 4 + d0;
  g.set(s0, 0);
  heap.push(h(ia), s0);
  let best = Infinity, bestState = -1;
  let guard = 0;
  while (heap.size > 0 && guard++ < 200000) {
    const [f, s] = heap.pop();
    if (f >= best) break;
    const gs = g.get(s)!;
    if (f > gs + h(s >> 2) + 1e-9) continue; // stale
    const v = s >> 2, d = (s & 3) as Dir;
    if (v === ib) {
      const total = gs + (d === arr ? 0 : BEND);
      if (d !== d1 && total < best) { best = total; bestState = s; }
      continue;
    }
    const ix = Math.floor(v / ny), iy = v % ny;
    for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
      if (nd === opp(d)) continue;
      const jx = ix + DX[nd], jy = iy + DY[nd];
      if (jx < 0 || jy < 0 || jx >= xs.length || jy >= ny) continue;
      const u = jx * ny + jy;
      if (blockedV(u)) continue;
      const mx = (xs[ix]! + xs[jx]!) / 2, my = (ys[iy]! + ys[jy]!) / 2;
      if (inside(mx, my)) continue;
      const ng = gs + Math.abs(xs[jx]! - xs[ix]!) + Math.abs(ys[jy]! - ys[iy]!) + (nd === d ? 0 : BEND);
      const us = u * 4 + nd;
      if (ng < (g.get(us) ?? Infinity)) {
        g.set(us, ng);
        parent.set(us, s);
        heap.push(ng + h(u), us);
      }
    }
  }
  if (bestState < 0) return null;
  const rev: Point[] = [];
  for (let s: number | undefined = bestState; s !== undefined; s = parent.get(s)) {
    const v = s >> 2;
    rev.push([xs[Math.floor(v / ny)]!, ys[v % ny]!]);
  }
  return normalize([p0, ...rev.reverse(), p1]);
}

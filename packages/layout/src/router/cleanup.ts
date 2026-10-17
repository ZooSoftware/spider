// Final passes: keep segments off container borders, remove small jogs at ports.
import type { Point } from "../layout-file.ts";
import { BORDER_GAP, type Ctx, type End, type Job } from "./types.ts";
import { alongBorder } from "./context.ts";
import { normalize, pathClear, sideRange } from "./geom.ts";
import { apply, collectSegs, tryMove } from "./nudge.ts";

/** Move interior segments that run along a container border to a lane just off it. */
export function avoidBorders(ctx: Ctx, jobs: Job[]): void {
  if (ctx.borders.length === 0) return;
  for (const ax of [0, 1] as const) {
    for (const s of collectSegs(jobs, ax)) {
      const near = ctx.borders.filter((b) => b.ax === ax && Math.abs(b.c - s.c) < BORDER_GAP && Math.min(s.hi, b.hi) - Math.max(s.lo, b.lo) > 0);
      if (near.length === 0) continue;
      const targets = near.flatMap((b) => [b.c - BORDER_GAP - 2, b.c + BORDER_GAP + 2]).sort((u, v) => Math.abs(u - s.c) - Math.abs(v - s.c));
      for (const nc of targets) {
        const moved = tryMove(s, nc);
        if (!moved || alongBorder(ctx.borders, moved[0], moved[1])) continue;
        apply(s, moved, nc);
        break;
      }
    }
  }
  // End segments can't be nudged: slide the port along its side instead (and the bend with it).
  for (const j of jobs) {
    for (const atStart of [true, false]) {
      const P = atStart ? j.pts : [...j.pts].reverse();
      if (P.length < 3 || !alongBorder(ctx.borders, P[0]!, P[1]!)) continue;
      const e = atStart ? j.s : j.t;
      const al: 0 | 1 = e.side === "left" || e.side === "right" ? 1 : 0;
      const [lo, hi] = sideRange(e.node, e.side);
      const near = ctx.borders.filter((b) => b.ax === al && Math.abs(b.c - P[0]![al]) < BORDER_GAP);
      const targets = near
        .flatMap((b) => [b.c - BORDER_GAP - 2, b.c + BORDER_GAP + 2])
        .filter((v) => v > lo + 4 && v < hi - 4)
        .sort((u, v) => Math.abs(u - P[0]![al]) - Math.abs(v - P[0]![al]));
      for (const v of targets) {
        const Q = P.map((p) => [p[0], p[1]] as Point);
        Q[0]![al] = v;
        Q[1]![al] = v;
        const full = atStart ? Q : [...Q].reverse();
        if (alongBorder(ctx.borders, Q[0]!, Q[1]!) || !pathClear(j.checker, full)) continue;
        j.pts = full;
        e.pos = Q[0]!;
        break;
      }
    }
  }
}

/** Length below which a bend pair next to a port is a "jog" worth removing. */
export const JOG = 20;

/**
 * Remove small jogs right after a port (port -> stub -> tiny sidestep -> ...) by sliding the
 * port along its side, if it stays on the side, keeps distance to other ports and stays clear.
 */
export function removeJogs(jobs: Job[]): void {
  const ports = new Map<string, Point[]>();
  const keyOf = (e: End): string => `${e.node.id}|${e.side}`;
  for (const j of jobs) {
    for (const [e, p] of [[j.s, j.pts[0]], [j.t, j.pts[j.pts.length - 1]]] as const) {
      if (!p) continue;
      const list = ports.get(keyOf(e)) ?? [];
      list.push(p);
      ports.set(keyOf(e), list);
    }
  }
  for (const j of jobs) {
    for (const atStart of [true, false]) {
      const P = atStart ? j.pts : [...j.pts].reverse();
      const e = atStart ? j.s : j.t;
      if (P.length < 4) continue;
      const p0 = P[0]!, p1 = P[1]!, p2 = P[2]!;
      const al: 0 | 1 = e.side === "left" || e.side === "right" ? 1 : 0;
      const delta = p2[al] - p1[al];
      if (delta === 0 || Math.abs(delta) >= JOG) continue;
      const [lo, hi] = sideRange(e.node, e.side);
      const v = p2[al];
      if (v <= lo || v >= hi) continue;
      const list = ports.get(keyOf(e)) ?? [];
      if (list.some((q) => q !== p0 && Math.abs(q[al] - v) < 6)) continue;
      const np0: Point = [p0[0], p0[1]];
      np0[al] = v;
      const rest = P.slice(3);
      const cand = normalize([np0, ...rest]);
      if (!cand) continue;
      const c1 = cand[1];
      if (c1 && Math.abs(c1[0] - np0[0]) + Math.abs(c1[1] - np0[1]) < e.stub) continue;
      const full = atStart ? cand : [...cand].reverse();
      if (!pathClear(j.checker, full)) continue;
      j.pts = full;
      const idx = list.indexOf(p0);
      if (idx >= 0) list[idx] = np0;
    }
  }
}

// Cheap candidate routes (straight / L / Z / U) between two ports.
import type { Rect } from "../geometry.ts";
import type { Point } from "../layout-file.ts";
import { BORDER_GAP, type Border, DX, DY, type Dir, opp } from "./types.ts";
import { type Checker, rectsIn } from "./obstacles.ts";
import { borderPenalty } from "./context.ts";
import { normalize, pathClear, pathCost, step } from "./geom.ts";

export interface Route {
  pts: Point[];
  cost: number;
}

/**
 * Cheapest collision-free route among straight / L / Z / U shapes between two ports, or null.
 * With `checker` undefined, returns the cheapest shape regardless of obstacles.
 */
export function shapeRoute(
  p0: Point, d0: Dir, l0: number,
  p1: Point, d1: Dir, l1: number,
  checker: Checker | undefined, extraCoords: boolean, borders: Border[] = [],
): Route | null {
  const a = step(p0, d0, l0), b = step(p1, d1, l1);
  const mids: Point[][] = [[], [[b[0], a[1]]], [[a[0], b[1]]]];
  const xs = new Set<number>([Math.round((a[0] + b[0]) / 2), a[0], b[0]]);
  const ys = new Set<number>([Math.round((a[1] + b[1]) / 2), a[1], b[1]]);
  if (checker) {
    const wx1 = Math.min(a[0], b[0]), wy1 = Math.min(a[1], b[1]);
    const window = { x: wx1, y: wy1, w: Math.max(a[0], b[0]) - wx1, h: Math.max(a[1], b[1]) - wy1 };
    const rs = extraCoords ? rectsIn(checker, window) : [checker.src, checker.tgt].filter((r): r is Rect => !!r);
    for (const r of rs) {
      xs.add(r.x - 1); xs.add(r.x + r.w + 1);
      ys.add(r.y - 1); ys.add(r.y + r.h + 1);
    }
    if (extraCoords) {
      // Lanes just off container borders, so there is an alternative to running along one.
      for (const br of borders) {
        if (br.c < (br.ax === 0 ? window.x : window.y) - BORDER_GAP || br.c > (br.ax === 0 ? window.x + window.w : window.y + window.h) + BORDER_GAP) continue;
        const set = br.ax === 0 ? xs : ys;
        set.add(br.c - BORDER_GAP - 2); set.add(br.c + BORDER_GAP + 2);
      }
    }
  }
  for (const x of xs) mids.push([[x, a[1]], [x, b[1]]]);
  for (const y of ys) mids.push([[a[0], y], [b[0], y]]);

  const cands: Route[] = [];
  // Facing, aligned ports: a single straight segment (also when the gap is shorter than the stubs).
  const ahead = (p1[0] - p0[0]) * DX[d0] + (p1[1] - p0[1]) * DY[d0];
  if (d1 === opp(d0) && ahead > 0 && (d0 % 2 === 0 ? p0[1] === p1[1] : p0[0] === p1[0])) {
    cands.push({ pts: [p0, p1], cost: pathCost([p0, p1]) + borderPenalty(borders, [p0, p1]) });
  }
  for (const m of mids) {
    const pts = normalize([p0, a, ...m, b, p1]);
    if (!pts) continue;
    if (!pts.every((p, i) => i === 0 || p[0] === pts[i - 1]![0] || p[1] === pts[i - 1]![1])) continue;
    cands.push({ pts, cost: pathCost(pts) + borderPenalty(borders, pts) });
  }
  // Stable sort keeps generation order on ties -> deterministic.
  cands.sort((u, v) => u.cost - v.cost);
  if (!checker) return cands[0] ?? null;
  for (const c of cands) if (pathClear(checker, c.pts)) return c;
  return null;
}

// Port sides per edge, and spreading edge ends that share a node side (slots).
import type { Side } from "@spider/profile-schema";
import { BEND, type Ctx, DX, DY, type End, type Job, ROUTE_MARGIN, SLOT_GAP, opp } from "./types.ts";
import { checkerFor } from "./context.ts";
import { minBends, sidePenalty, sidePoint, sideRange, step, stubDir } from "./geom.ts";
import { shapeRoute } from "./candidates.ts";

export function chooseSides(ctx: Ctx, j: Job): void {
  j.base = j.checker = checkerFor(ctx, j, ROUTE_MARGIN);
  interface Combo { ss: Side; ts: Side; lb: number; i: number }
  const combos: Combo[] = [];
  for (const ss of j.s.sides) {
    for (const ts of j.t.sides) {
      j.s.side = ss; j.t.side = ts;
      const d0 = stubDir(j.s), d1 = stubDir(j.t);
      const a = step(sidePoint(j.s.node, ss), d0, j.s.stub), b = step(sidePoint(j.t.node, ts), d1, j.t.stub);
      const lb = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + j.s.stub + j.t.stub + BEND * minBends(a, d0, b, opp(d1)) +
        sidePenalty(j.s, j.t) + sidePenalty(j.t, j.s);
      combos.push({ ss, ts, lb, i: combos.length });
    }
  }
  combos.sort((u, v) => u.lb - v.lb || u.i - v.i);
  let best: Combo | undefined, bestCost = Infinity;
  for (const c of combos) {
    if (c.lb >= bestCost) break;
    j.s.side = c.ss; j.t.side = c.ts;
    const r = shapeRoute(sidePoint(j.s.node, c.ss), stubDir(j.s), j.s.stub, sidePoint(j.t.node, c.ts), stubDir(j.t), j.t.stub, j.checker, false, ctx.borders);
    if (!r) continue;
    const cost = r.cost + sidePenalty(j.s, j.t) + sidePenalty(j.t, j.s);
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  const pick = best ?? combos[0]!;
  j.s.side = pick.ss;
  j.t.side = pick.ts;
}

export type SlotKey = (m: { job: Job; end: End; other: End }, alongAxis: 0 | 1) => number;

/** Initial slot order: position of the opposite node. */
export const nodeKey: SlotKey = (m, al) => (al === 1 ? m.other.node.box.y + m.other.node.box.h / 2 : m.other.node.box.x + m.other.node.box.w / 2);

/** Refined slot order: where the routed edge heads after its first bend. */
export const routeKey: SlotKey = (m, al) => {
  const P = m.end === m.job.s ? m.job.pts : [...m.job.pts].reverse();
  const p = P[2] ?? P[P.length - 1];
  return p ? p[al] : nodeKey(m, al);
};

export function assignSlots(jobs: Job[], slotKey: SlotKey): void {
  const groups = new Map<string, { job: Job; end: End; other: End }[]>();
  for (const j of jobs) {
    for (const [end, other] of [[j.s, j.t], [j.t, j.s]] as const) {
      const key = `${end.node.id}\u0000${end.side}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push({ job: j, end, other });
    }
  }
  for (const g of groups.values()) {
    const al: 0 | 1 = g[0]!.end.side === "left" || g[0]!.end.side === "right" ? 1 : 0;
    g.sort((u, v) => slotKey(u, al) - slotKey(v, al) || nodeKey(u, al) - nodeKey(v, al) || u.job.index - v.job.index ||
      (u.end === u.job.s ? -1 : 1));
    const [lo, hi] = sideRange(g[0]!.end.node, g[0]!.end.side);
    const k = g.length;
    const gap = Math.min((hi - lo) / (k + 1), SLOT_GAP);
    const start = (lo + hi) / 2 - (gap * (k - 1)) / 2;
    g.forEach((m, i) => {
      m.end.pos = sidePoint(m.end.node, m.end.side, Math.round(start + i * gap));
    });
  }
  // Bundles: when two facing sides carry exactly the same edges (incl. a single edge), align
  // their slots inside the overlap of both sides so the edges run straight.
  const done = new Set<string>();
  for (const [key, g] of groups) {
    if (done.has(key)) continue;
    const o = g[0]!.other;
    const okey = `${o.node.id}\u0000${o.side}`;
    const h = groups.get(okey);
    if (!h || h.length !== g.length || okey === key) continue;
    if (!g.every((m) => m.other.node === o.node && m.other.side === o.side)) continue;
    if (!h.every((m) => g.some((x) => x.job === m.job))) continue;
    done.add(key); done.add(okey);
    const e0 = g[0]!.end;
    const d0 = stubDir(e0), d1 = stubDir(o);
    if (d0 !== opp(d1)) continue;
    const [slo, shi, sf] = sideRange(e0.node, e0.side);
    const [tlo, thi, tf] = sideRange(o.node, o.side);
    if ((tf - sf) * (DX[d0] + DY[d0]) <= 0) continue;
    const lo = Math.max(slo, tlo), hi = Math.min(shi, thi);
    const k = g.length;
    const gap = Math.min((hi - lo) / (k + 1), SLOT_GAP);
    const half = (gap * (k - 1)) / 2;
    if (hi - lo < 4 || lo + half + 1 > hi - half - 1) continue;
    const want = ((slo + shi) / 2 + (tlo + thi) / 2) / 2;
    const center = Math.min(Math.max(want, lo + half + 1), hi - half - 1);
    g.forEach((m, i) => {
      const v = Math.round(center - half + i * gap);
      m.end.pos = sidePoint(m.end.node, m.end.side, v);
      const twin = h.find((x) => x.job === m.job && x.end !== m.end)!;
      twin.end.pos = sidePoint(twin.end.node, twin.end.side, v);
    });
  }
}

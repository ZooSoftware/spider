// Per-call routing context: node infos, obstacles, container borders, jobs and checkers.
import type { Model, ModelEdge } from "@spider/core";
import type { ResolvedProfile, Side } from "@spider/profile-schema";
import { type Rect, ancestors, isContainer, kindOf, labelSpace, rectsOverlap } from "../geometry.ts";
import type { EdgeLayout, NodeLayout, Point } from "../layout-file.ts";
import { ALL_SIDES, ARROW_STUB, BORDER_COST, BORDER_GAP, type Border, type Ctx, type Job, type NodeInfo, ROUTE_MARGIN, STUB } from "./types.ts";
import { type Checker, ObstacleIndex } from "./obstacles.ts";

export function buildCtx(model: Model, profile: ResolvedProfile, nodes: Record<string, NodeLayout>): Ctx {
  const infos = new Map<string, NodeInfo>();
  const obstacles: Rect[] = [];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of model.nodes.values()) {
    const l = nodes[n.id];
    if (!l) continue;
    const below = labelSpace(profile, n);
    const box = { x: l.x, y: l.y, w: l.w, h: l.h + below };
    const ports = kindOf(profile, n)?.ports;
    const info: NodeInfo = {
      id: n.id,
      box,
      shape: { x: l.x, y: l.y, w: l.w, h: l.h },
      labelBelow: below > 0,
      anc: ancestors(model, n.id),
      obstacle: obstacles.length,
    };
    if (ports && ports.length > 0 && !isContainer(n)) info.ports = ports;
    infos.set(n.id, info);
    obstacles.push(box);
    x1 = Math.min(x1, box.x); y1 = Math.min(y1, box.y);
    x2 = Math.max(x2, box.x + box.w); y2 = Math.max(y2, box.y + box.h);
  }
  const bounds = x1 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  const borders: Border[] = [];
  for (const n of model.nodes.values()) {
    const l = nodes[n.id];
    if (!l || !isContainer(n)) continue;
    borders.push(
      { ax: 1, c: l.y, lo: l.x, hi: l.x + l.w },
      { ax: 1, c: l.y + l.h, lo: l.x, hi: l.x + l.w },
      { ax: 0, c: l.x, lo: l.y, hi: l.y + l.h },
      { ax: 0, c: l.x + l.w, lo: l.y, hi: l.y + l.h },
    );
  }
  return { infos, obstacles, index: new ObstacleIndex(obstacles), bounds, borders };
}

/** Which ends of an edge get an arrowhead (renderer default: end). */
export function arrowsOf(profile: ResolvedProfile, e: ModelEdge): { start: boolean; end: boolean } {
  const name = e.kind ?? profile.defaultEdge;
  const arrow = (name ? profile.edges[name]?.arrow : undefined) ?? "end";
  return { start: arrow === "start" || arrow === "both", end: arrow === "end" || arrow === "both" };
}

/** Penalty for segments running along (parallel and within BORDER_GAP of) a container border. */
export function borderPenalty(borders: Border[], pts: Point[]): number {
  let p = 0;
  for (let i = 0; i + 1 < pts.length; i++) if (alongBorder(borders, pts[i]!, pts[i + 1]!)) p += BORDER_COST;
  return p;
}

export function alongBorder(borders: Border[], a: Point, b: Point): boolean {
  const ax: 0 | 1 = a[0] === b[0] ? 0 : 1;
  const al = 1 - ax;
  const c = a[ax], lo = Math.min(a[al]!, b[al]!), hi = Math.max(a[al]!, b[al]!);
  for (const br of borders) {
    if (br.ax === ax && Math.abs(br.c - c) < BORDER_GAP && Math.min(hi, br.hi) - Math.max(lo, br.lo) > 0) return true;
  }
  return false;
}

export function allowedSides(n: NodeInfo, stored: Side | undefined): Side[] {
  const base = n.ports ?? ALL_SIDES;
  if (stored && base.includes(stored)) return [stored];
  return base;
}

export function makeJob(
  ctx: Ctx,
  edge: ModelEdge,
  index: number,
  s: NodeInfo,
  t: NodeInfo,
  prev: EdgeLayout | undefined,
  arrows: { start: boolean; end: boolean },
): Job {
  const excluded = new Set<number>([s.obstacle, t.obstacle]);
  for (const a of [...s.anc, ...t.anc]) {
    const i = ctx.infos.get(a)?.obstacle;
    if (i !== undefined) excluded.add(i);
  }
  // Boxes overlapping an endpoint (e.g. a container drawn around it) cannot be avoided.
  ctx.obstacles.forEach((r, i) => {
    if (rectsOverlap(r, s.box) || rectsOverlap(r, t.box)) excluded.add(i);
  });
  const sIn = t.anc.includes(s.id), tIn = s.anc.includes(t.id);
  const ss = allowedSides(s, prev?.sourcePort), ts = allowedSides(t, prev?.targetPort);
  const job: Job = {
    edge,
    index,
    s: { node: s, stub: arrows.start ? ARROW_STUB : STUB, sides: ss, inward: sIn, side: ss[0]!, pos: [0, 0] },
    t: { node: t, stub: arrows.end ? ARROW_STUB : STUB, sides: ts, inward: tIn, side: ts[0]!, pos: [0, 0] },
    excluded,
    pts: [],
    base: { idx: ctx.index, excluded, margin: ROUTE_MARGIN },
    checker: { idx: ctx.index, excluded, margin: ROUTE_MARGIN },
  };
  if (prev) job.prev = prev;
  return job;
}

export function checkerFor(ctx: Ctx, j: Job, margin: number): Checker {
  const c: Checker = { idx: ctx.index, excluded: j.excluded, margin };
  const pad = STUB - 1;
  const grow = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
  if (!j.s.inward) c.src = grow(j.s.node.box);
  if (!j.t.inward) c.tgt = grow(j.t.node.box);
  return c;
}

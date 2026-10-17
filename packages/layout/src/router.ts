// Orthogonal edge router. Synchronous, deterministic and DOM-free: used by layoutDiagram and by
// the editor to re-route live while a node is dragged.
//
// Pipeline per call:
//   1. sides:  per edge pick (source side, target side) by evaluating cheap candidate routes
//              (straight / L / Z / U) between side midpoints; honors kind `ports` and stored ports.
//   2. slots:  spread all edge ends that share a node side across that side, ordered by the
//              position of the opposite node (fewer crossings); lone facing ends are straightened.
//   3. route:  candidate shapes again with the real port points; if all collide, A* over a sparse
//              orthogonal grid (obstacle boundaries + midlines) with a bend penalty.
//   4. nudge:  overlapping collinear interior segments of different edges are spread apart.
import type { Model, ModelEdge } from "@spider/core";
import type { ResolvedProfile, Side } from "@spider/profile-schema";
import { ancestors, isContainer, kindOf, labelSpace, rectsOverlap, type Rect } from "./geometry.ts";
import type { EdgeLayout, NodeLayout, Point } from "./layout-file.ts";

/** Clearance kept between routes and non-endpoint node boxes. */
export const ROUTE_MARGIN = 12;
/** Length of the straight stub leaving/entering a port. */
const STUB = 12;
/** Arrowhead length drawn by the renderer (marker 8 × stroke 1.5). */
export const ARROW_LENGTH = 12;
/** Minimum straight run at an end with an arrowhead, so the arrow never sits on a bend. */
export const ARROW_STUB = ARROW_LENGTH + 12;
/** Segments closer than this to a container border (and parallel to it) look like the border. */
export const BORDER_GAP = 10;
/** Cost of running along a container border, in px of route length. */
const BORDER_COST = 2 * 40;
/** Cost of one bend, in px of route length. */
const BEND = 40;
/** Distance between nudged parallel segments. */
const SEP = 10;
/** Weight of the penalty for a port side facing away from the other endpoint. */
const FACING = 30;
/** Maximum distance between neighboring ports on one side. */
const SLOT_GAP = 28;

/** right, down, left, up */
type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;
const SIDE_DIR: Record<Side, Dir> = { right: 0, bottom: 1, left: 2, top: 3 };
const ALL_SIDES: Side[] = ["right", "bottom", "left", "top"];
const opp = (d: Dir): Dir => ((d + 2) % 4) as Dir;

interface NodeInfo {
  id: string;
  /** Occupied box incl. outside label; the routing boundary. */
  box: Rect;
  /** Shape box; left/right ports stay within its vertical extent. */
  shape: Rect;
  ports?: Side[];
  labelBelow: boolean;
  anc: string[];
  obstacle: number;
}

interface End {
  node: NodeInfo;
  /** Length of the straight run at this end (longer where an arrowhead is drawn). */
  stub: number;
  sides: Side[];
  /** Endpoint is an ancestor container of the other end: stub points inward. */
  inward: boolean;
  side: Side;
  pos: Point;
}

/** Uniform-grid spatial index over obstacle boxes (registered with ROUTE_MARGIN inflation). */
class ObstacleIndex {
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

interface Checker {
  idx: ObstacleIndex;
  excluded: Set<number>;
  margin: number;
  src?: Rect;
  tgt?: Rect;
}

/** Obstacle rects (inflated by the checker margin) meeting a window; plus src/tgt boxes. */
function rectsIn(c: Checker, w: Rect): Rect[] {
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

interface Job {
  edge: ModelEdge;
  index: number;
  s: End;
  t: End;
  excluded: Set<number>;
  pts: Point[];
  /** Checker with the full margin (from side selection). */
  base: Checker;
  /** Checker the current route was validated with (margin may have been relaxed). */
  checker: Checker;
  prev?: EdgeLayout;
}

interface Ctx {
  infos: Map<string, NodeInfo>;
  obstacles: Rect[];
  index: ObstacleIndex;
  bounds: Rect;
  /** Container border lines; routes should cross them, never run along them. */
  borders: Border[];
}

interface Border {
  /** 0: vertical line at x = c; 1: horizontal line at y = c. */
  ax: 0 | 1;
  c: number;
  lo: number;
  hi: number;
}

// ---------------------------------------------------------------------------------------------

export function routeEdges(
  model: Model,
  profile: ResolvedProfile,
  nodes: Record<string, NodeLayout>,
  previous: Record<string, EdgeLayout> = {},
): Record<string, EdgeLayout> {
  const ctx = buildCtx(model, profile, nodes);
  const done = new Map<string, EdgeLayout>();
  const jobs: Job[] = [];
  const loops: { edge: ModelEdge; node: NodeInfo; prev?: EdgeLayout }[] = [];
  let index = 0;
  for (const e of model.edges.values()) {
    const s = ctx.infos.get(e.source), t = ctx.infos.get(e.target);
    if (!s || !t) continue;
    const prev = previous[e.id];
    if (prev?.manual && prev.points.length >= 2) {
      done.set(e.id, finish(e, resnapManual(prev, s, t), prev, true));
    } else if (s === t) {
      loops.push(prev ? { edge: e, node: s, prev } : { edge: e, node: s });
    } else {
      jobs.push(makeJob(ctx, e, index++, s, t, prev, arrowsOf(profile, e)));
    }
  }

  for (const j of jobs) chooseSides(ctx, j);
  assignSlots(jobs, nodeKey);
  for (const j of jobs) routeJob(ctx, j);
  assignSlots(jobs, routeKey);
  for (const j of jobs) routeJob(ctx, j);
  nudge(jobs);
  avoidBorders(ctx, jobs);
  removeJogs(jobs);
  for (const j of jobs) done.set(j.edge.id, finish(j.edge, j.pts, j.prev, false));
  const used = new Map<string, number>();
  for (const j of jobs) for (const e of [j.s, j.t]) used.set(`${e.node.id}|${e.side}`, (used.get(`${e.node.id}|${e.side}`) ?? 0) + 1);
  const nth = new Map<string, number>();
  for (const l of loops) {
    const i = nth.get(l.node.id) ?? 0;
    nth.set(l.node.id, i + 1);
    const load = (side: Side): number => used.get(`${l.node.id}|${side}`) ?? 0;
    done.set(l.edge.id, finish(l.edge, selfLoop(l.node, i, load, jobs), l.prev, false));
  }

  const out: Record<string, EdgeLayout> = {};
  for (const id of model.edges.keys()) {
    const l = done.get(id);
    if (l) out[id] = l;
  }
  return out;
}

function buildCtx(model: Model, profile: ResolvedProfile, nodes: Record<string, NodeLayout>): Ctx {
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
function arrowsOf(profile: ResolvedProfile, e: ModelEdge): { start: boolean; end: boolean } {
  const name = e.kind ?? profile.defaultEdge;
  const arrow = (name ? profile.edges[name]?.arrow : undefined) ?? "end";
  return { start: arrow === "start" || arrow === "both", end: arrow === "end" || arrow === "both" };
}

/** Penalty for segments running along (parallel and within BORDER_GAP of) a container border. */
function borderPenalty(borders: Border[], pts: Point[]): number {
  let p = 0;
  for (let i = 0; i + 1 < pts.length; i++) if (alongBorder(borders, pts[i]!, pts[i + 1]!)) p += BORDER_COST;
  return p;
}

function alongBorder(borders: Border[], a: Point, b: Point): boolean {
  const ax: 0 | 1 = a[0] === b[0] ? 0 : 1;
  const al = 1 - ax;
  const c = a[ax], lo = Math.min(a[al]!, b[al]!), hi = Math.max(a[al]!, b[al]!);
  for (const br of borders) {
    if (br.ax === ax && Math.abs(br.c - c) < BORDER_GAP && Math.min(hi, br.hi) - Math.max(lo, br.lo) > 0) return true;
  }
  return false;
}

function allowedSides(n: NodeInfo, stored: Side | undefined): Side[] {
  const base = n.ports ?? ALL_SIDES;
  if (stored && base.includes(stored)) return [stored];
  return base;
}

function makeJob(
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

function checkerFor(ctx: Ctx, j: Job, margin: number): Checker {
  const c: Checker = { idx: ctx.index, excluded: j.excluded, margin };
  const pad = STUB - 1;
  const grow = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
  if (!j.s.inward) c.src = grow(j.s.node.box);
  if (!j.t.inward) c.tgt = grow(j.t.node.box);
  return c;
}

// ---- geometry helpers -----------------------------------------------------------------------

/** [lo, hi, fixed] of the port range on a side. */
function sideRange(n: NodeInfo, side: Side): [number, number, number] {
  const { box, shape } = n;
  switch (side) {
    case "right": return [shape.y, shape.y + shape.h, box.x + box.w];
    case "left": return [shape.y, shape.y + shape.h, box.x];
    case "top": return [box.x, box.x + box.w, box.y];
    case "bottom": return [box.x, box.x + box.w, box.y + box.h];
  }
}

function sidePoint(n: NodeInfo, side: Side, along?: number): Point {
  const [lo, hi, fixed] = sideRange(n, side);
  const a = along ?? Math.round((lo + hi) / 2);
  return side === "left" || side === "right" ? [fixed, a] : [a, fixed];
}

/** Direction of the stub leaving the endpoint. */
function stubDir(e: End): Dir {
  const d = SIDE_DIR[e.side];
  return e.inward ? opp(d) : d;
}

function step(p: Point, d: Dir, len: number): Point {
  return [p[0] + DX[d] * len, p[1] + DY[d] * len];
}

function segHits(p: Point, q: Point, r: Rect): boolean {
  const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]);
  const y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
  if (y1 === y2) return y1 > r.y && y1 < r.y + r.h && x2 > r.x && x1 < r.x + r.w;
  return x1 > r.x && x1 < r.x + r.w && y2 > r.y && y1 < r.y + r.h;
}

function segClear(c: Checker, p: Point, q: Point, first: boolean, last: boolean): boolean {
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

function pathClear(c: Checker, pts: Point[]): boolean {
  for (let i = 0; i + 1 < pts.length; i++) if (!segClear(c, pts[i]!, pts[i + 1]!, i === 0, i === pts.length - 2)) return false;
  return true;
}

/** Drop duplicate points and merge collinear runs. Returns null if the path doubles back. */
function normalize(pts: Point[]): Point[] | null {
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

function pathCost(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.abs(pts[i + 1]![0] - pts[i]![0]) + Math.abs(pts[i + 1]![1] - pts[i]![1]);
  return len + BEND * Math.max(0, pts.length - 2);
}

/** Penalty for sides that do not face the other endpoint, and for bottom ports under labels. */
function sidePenalty(e: End, other: End): number {
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
function minBends(a: Point, d0: Dir, b: Point, arr: Dir): number {
  if (d0 === arr) {
    const ahead = (b[0] - a[0]) * DX[d0] + (b[1] - a[1]) * DY[d0] >= 0;
    const aligned = d0 % 2 === 0 ? a[1] === b[1] : a[0] === b[0];
    return ahead && aligned ? 0 : 2;
  }
  return d0 === opp(arr) ? 2 : 1;
}

// ---- candidate shapes -------------------------------------------------------------------------

interface Route {
  pts: Point[];
  cost: number;
}

/**
 * Cheapest collision-free route among straight / L / Z / U shapes between two ports, or null.
 * With `checker` undefined, returns the cheapest shape regardless of obstacles.
 */
function shapeRoute(
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

// ---- A* fallback ------------------------------------------------------------------------------

class Heap {
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

function sortedCoords(vals: Iterable<number>, lo: number, hi: number): number[] {
  const base = [...new Set([...vals].filter((v) => v >= lo && v <= hi))].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < base.length; i++) {
    out.push(base[i]!);
    const n = base[i + 1];
    if (n !== undefined && n - base[i]! > 2) out.push(Math.round((base[i]! + n) / 2));
  }
  return out;
}

function astar(p0: Point, d0: Dir, l0: number, p1: Point, d1: Dir, l1: number, c: Checker, window: Rect): Point[] | null {
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

// ---- pipeline stages --------------------------------------------------------------------------

function chooseSides(ctx: Ctx, j: Job): void {
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

type SlotKey = (m: { job: Job; end: End; other: End }, alongAxis: 0 | 1) => number;

/** Initial slot order: position of the opposite node. */
const nodeKey: SlotKey = (m, al) => (al === 1 ? m.other.node.box.y + m.other.node.box.h / 2 : m.other.node.box.x + m.other.node.box.w / 2);

/** Refined slot order: where the routed edge heads after its first bend. */
const routeKey: SlotKey = (m, al) => {
  const P = m.end === m.job.s ? m.job.pts : [...m.job.pts].reverse();
  const p = P[2] ?? P[P.length - 1];
  return p ? p[al] : nodeKey(m, al);
};

function assignSlots(jobs: Job[], slotKey: SlotKey): void {
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

function routeJob(ctx: Ctx, j: Job): void {
  const d0 = stubDir(j.s), d1 = stubDir(j.t);
  const b = ctx.bounds;
  for (const margin of [ROUTE_MARGIN, 4]) {
    const c = margin === ROUTE_MARGIN ? j.base : checkerFor(ctx, j, margin);
    const r = shapeRoute(j.s.pos, d0, j.s.stub, j.t.pos, d1, j.t.stub, c, true, ctx.borders);
    if (r) { j.pts = r.pts; j.checker = c; return; }
    const pad = 4 * STUB + margin;
    const x1 = Math.min(j.s.pos[0], j.t.pos[0]), x2 = Math.max(j.s.pos[0], j.t.pos[0]);
    const y1 = Math.min(j.s.pos[1], j.t.pos[1]), y2 = Math.max(j.s.pos[1], j.t.pos[1]);
    const near: Rect = { x: x1 - 120, y: y1 - 120, w: x2 - x1 + 240, h: y2 - y1 + 240 };
    const full: Rect = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    const p = astar(j.s.pos, d0, j.s.stub, j.t.pos, d1, j.t.stub, c, near) ?? astar(j.s.pos, d0, j.s.stub, j.t.pos, d1, j.t.stub, c, full);
    if (p) { j.pts = p; j.checker = c; return; }
  }
  j.pts = shapeRoute(j.s.pos, d0, j.s.stub, j.t.pos, d1, j.t.stub, undefined, false)?.pts ?? [j.s.pos, j.t.pos];
}

interface Seg {
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
function crossings(a: Seg, b: Seg): number {
  const inside = (v: number, s: Seg): boolean => v > s.lo && v < s.hi;
  let n = 0;
  if (b.sIn > 0 && inside(b.s0, a)) n++;
  if (b.sOut < 0 && inside(b.s1, a)) n++;
  if (a.sIn < 0 && inside(a.s0, b)) n++;
  if (a.sOut > 0 && inside(a.s1, b)) n++;
  return n;
}

function collectSegs(jobs: Job[], ax: 0 | 1): Seg[] {
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

function nudge(jobs: Job[]): void {
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

function spread(g: Seg[]): void {
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
function tryMove(s: Seg, nc: number): [Point, Point] | null {
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

function apply(s: Seg, pq: [Point, Point], nc: number): void {
  s.job.pts[s.k] = pq[0];
  s.job.pts[s.k + 1] = pq[1];
  s.c = nc;
}

/** Move interior segments that run along a container border to a lane just off it. */
function avoidBorders(ctx: Ctx, jobs: Job[]): void {
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
const JOG = 20;

/**
 * Remove small jogs right after a port (port -> stub -> tiny sidestep -> ...) by sliding the
 * port along its side, if it stays on the side, keeps distance to other ports and stays clear.
 */
function removeJogs(jobs: Job[]): void {
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

// ---- self loops, manual edges, output ---------------------------------------------------------

const CORNERS: [Side, Side][] = [["top", "right"], ["right", "bottom"], ["bottom", "left"], ["left", "top"]];

function loopPoints(box: Rect, corner: Side, i: number): Point[] {
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
function selfLoop(n: NodeInfo, i: number, load: (s: Side) => number, jobs: Job[]): Point[] {
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

function onBoundary(p: Point, r: Rect): boolean {
  const eps = 0.5;
  const inX = p[0] >= r.x - eps && p[0] <= r.x + r.w + eps;
  const inY = p[1] >= r.y - eps && p[1] <= r.y + r.h + eps;
  return (inY && (Math.abs(p[0] - r.x) <= eps || Math.abs(p[0] - r.x - r.w) <= eps)) ||
    (inX && (Math.abs(p[1] - r.y) <= eps || Math.abs(p[1] - r.y - r.h) <= eps));
}

/** Move an endpoint onto the box boundary toward its neighbor point, keeping orthogonality. */
function snapEnd(r: Rect, toward: Point): Point[] {
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

function resnapManual(prev: EdgeLayout, s: NodeInfo, t: NodeInfo): Point[] {
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

function labelPoint(pts: Point[]): Point | undefined {
  let best = -1, at: Point | undefined;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
    if (len > best) { best = len; at = [Math.round((p[0] + q[0]) / 2), Math.round((p[1] + q[1]) / 2)]; }
  }
  return at;
}

function finish(e: ModelEdge, pts: Point[], prev: EdgeLayout | undefined, manual: boolean): EdgeLayout {
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

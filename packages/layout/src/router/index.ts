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
//
// Files: types (constants, shared types) · obstacles (spatial index) · context (per-call setup)
// · geom · slots (1–2) · candidates + astar (3) · nudge (4) · cleanup (border lanes, jogs)
// · finish (self loops, manual routes, output).
import type { Model, ModelEdge } from "@spider/core";
import type { ResolvedProfile, Side } from "@spider/profile-schema";
import type { Rect } from "../geometry.ts";
import type { EdgeLayout, NodeLayout } from "../layout-file.ts";
import { type Ctx, type Job, type NodeInfo, ROUTE_MARGIN, STUB } from "./types.ts";
import { arrowsOf, buildCtx, checkerFor, makeJob } from "./context.ts";
import { stubDir } from "./geom.ts";
import { shapeRoute } from "./candidates.ts";
import { astar } from "./astar.ts";
import { assignSlots, chooseSides, nodeKey, routeKey } from "./slots.ts";
import { nudge } from "./nudge.ts";
import { avoidBorders, removeJogs } from "./cleanup.ts";
import { finish, resnapManual, selfLoop } from "./finish.ts";

export { ARROW_LENGTH, ARROW_STUB, BORDER_GAP, ROUTE_MARGIN } from "./types.ts";

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

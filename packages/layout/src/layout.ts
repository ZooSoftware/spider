// layoutDiagram: reconcile -> place (full ELK, or incremental around existing nodes) -> fit
// containers -> route edges. Existing node positions are never changed by incremental layout.
import type { Model } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import { DEFAULT_NODE_SPACING, elkPlace } from "./elk-adapter.ts";
import {
  ancestors,
  CONTAINER_PADDING,
  CONTAINER_TITLE_SPACE,
  fitContainers,
  isContainer,
  occupiedRect,
  rectsOverlap,
  type Rect,
} from "./geometry.ts";
import { reconcileLayout } from "./layout-io.ts";
import type { LayoutFile, NodeLayout } from "./layout-file.ts";
import { routeEdges } from "./router/index.ts";

export interface LayoutOptions {
  /** Ignore all previous positions and lay out from scratch. */
  reset?: boolean;
}

export async function layoutDiagram(
  model: Model,
  profile: ResolvedProfile,
  previous?: LayoutFile,
  opts: LayoutOptions = {},
): Promise<LayoutFile> {
  const prev = previous && !opts.reset ? reconcileLayout(model, previous) : undefined;
  const placed = prev ? { ...prev.nodes } : {};
  const missing = [...model.nodes.keys()].filter((id) => !placed[id]);

  let nodes: Record<string, NodeLayout>;
  if (!prev || Object.keys(placed).length === 0) {
    nodes = fullPlacement(model, await elkPlace(model, profile));
  } else if (missing.length > 0) {
    nodes = incrementalPlacement(model, profile, placed, await elkPlace(model, profile));
  } else {
    nodes = placed;
  }
  fitContainers(model, profile, nodes);

  const ordered: Record<string, NodeLayout> = {};
  for (const id of model.nodes.keys()) {
    const n = nodes[id];
    if (n) ordered[id] = n;
  }
  const edges = routeEdges(model, profile, ordered, prev?.edges);
  return { version: 1, nodes: ordered, edges };
}

function toLayout(r: Rect): NodeLayout {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function fullPlacement(model: Model, elk: Record<string, Rect>): Record<string, NodeLayout> {
  const out: Record<string, NodeLayout> = {};
  for (const id of model.nodes.keys()) {
    const r = elk[id];
    if (r) out[id] = toLayout(r);
  }
  return out;
}

/**
 * Place nodes missing from `placed` without touching existing ones:
 *  - group missing nodes into units (a missing node whose subtree has no placed node is moved
 *    as one block with its whole subtree);
 *  - map each unit's ELK position into current coordinates via an anchor that is already
 *    placed (an edge neighbor if possible, else the nearest placed node in ELK space);
 *  - nudge the unit to the nearest free spot (existing boxes + spacing as obstacles).
 */
function incrementalPlacement(
  model: Model,
  profile: ResolvedProfile,
  placed: Record<string, NodeLayout>,
  elk: Record<string, Rect>,
): Record<string, NodeLayout> {
  const nodes: Record<string, NodeLayout> = { ...placed };
  const gap = profile.layout.nodeSpacing ?? DEFAULT_NODE_SPACING;

  const subtree = (id: string): string[] => {
    const out: string[] = [];
    const walk = (x: string): void => {
      if (out.includes(x)) return;
      out.push(x);
      for (const c of model.nodes.get(x)?.children ?? []) if (model.nodes.has(c)) walk(c);
    };
    walk(id);
    return out;
  };
  const hasPlaced = (id: string): boolean => subtree(id).some((x) => placed[x] !== undefined);

  // Units: top-most missing nodes whose subtree contains nothing placed. Missing containers that
  // wrap placed nodes are not units: their box is derived from their children.
  const units: string[] = [];
  for (const [id, n] of model.nodes) {
    if (placed[id] || hasPlaced(id)) continue;
    const p = n.parent;
    if (p !== undefined && model.nodes.has(p) && !placed[p] && !hasPlaced(p)) continue;
    units.push(id);
  }

  const neighbors = new Map<string, string[]>();
  for (const e of model.edges.values()) {
    if (e.source === e.target) continue;
    (neighbors.get(e.source) ?? neighbors.set(e.source, []).get(e.source)!).push(e.target);
    (neighbors.get(e.target) ?? neighbors.set(e.target, []).get(e.target)!).push(e.source);
  }
  const isLeafPlaced = (id: string): boolean => nodes[id] !== undefined && !isContainer(model.nodes.get(id)!);

  // Prefer units connected to already placed nodes, so chains of new nodes grow outward.
  const pending = [...units];
  while (pending.length > 0) {
    let pick = pending.findIndex((u) => subtree(u).some((m) => (neighbors.get(m) ?? []).some(isLeafPlaced)));
    if (pick < 0) pick = 0;
    const unit = pending.splice(pick, 1)[0]!;
    const members = subtree(unit);
    const er = elk[unit];
    if (!er) continue;

    // Anchor: a placed edge neighbor (model order), else the nearest placed leaf in ELK space.
    let anchor: string | undefined;
    for (const m of members) {
      anchor = (neighbors.get(m) ?? []).find((x) => isLeafPlaced(x) && elk[x] && !members.includes(x));
      if (anchor) break;
    }
    if (!anchor) {
      let best = Infinity;
      for (const id of model.nodes.keys()) {
        const r = elk[id];
        if (!r || !isLeafPlaced(id)) continue;
        const d = Math.abs(r.x - er.x) + Math.abs(r.y - er.y);
        if (d < best) { best = d; anchor = id; }
      }
    }
    let dx = 0, dy = 0;
    if (anchor) {
      dx = nodes[anchor]!.x - elk[anchor]!.x;
      dy = nodes[anchor]!.y - elk[anchor]!.y;
    }

    const leafRects = new Map<string, Rect>();
    for (const m of members) {
      const r = elk[m];
      const n = model.nodes.get(m)!;
      if (r && (!isContainer(n) || n.children.length === 0)) leafRects.set(m, { ...r, x: r.x + dx, y: r.y + dy });
    }
    // Unit footprint: its ELK box (containers include padding) incl. label space.
    const un = model.nodes.get(unit)!;
    const foot = occupiedRect(profile, un, { x: er.x + dx, y: er.y + dy, w: er.w, h: er.h });

    const ancList = ancestors(model, unit);
    const anc = new Set(ancList);
    fitContainers(model, profile, nodes);
    const obstacles: { id: string; r: Rect }[] = [];
    for (const [id, l] of Object.entries(nodes)) {
      if (!anc.has(id)) obstacles.push({ id, r: occupiedRect(profile, model.nodes.get(id)!, l) });
    }
    // An ancestor container grows to fit the unit; it must not swallow unrelated nodes.
    const ancInfo = ancList.flatMap((a) => {
      const box = nodes[a];
      if (!box) return [];
      const inside = new Set([...subtree(a), ...ancestors(model, a)]);
      return [{ box, others: obstacles.filter((o) => !inside.has(o.id)).map((o) => o.r) }];
    });
    const blocked = (r: Rect): boolean => {
      if (obstacles.some((o) => rectsOverlap(r, o.r, gap - 1))) return true;
      let inner: Rect = r;
      for (const { box, others } of ancInfo) {
        const x1 = Math.min(box.x, inner.x - CONTAINER_PADDING), y1 = Math.min(box.y, inner.y - CONTAINER_TITLE_SPACE);
        const x2 = Math.max(box.x + box.w, inner.x + inner.w + CONTAINER_PADDING);
        const y2 = Math.max(box.y + box.h, inner.y + inner.h + CONTAINER_PADDING);
        inner = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        if (others.some((o) => rectsOverlap(inner, o, gap / 2 - 1))) return true;
      }
      return false;
    };
    const [ox, oy] = freeSpot(foot, obstacles.map((o) => o.r), gap, blocked);
    for (const [m, r] of leafRects) nodes[m] = toLayout({ ...r, x: r.x + ox, y: r.y + oy });
  }
  return nodes;
}

/** Smallest displacement [dx, dy] that moves `r` clear of all obstacles (with `gap`). */
export function freeSpot(
  r: Rect,
  obstacles: Rect[],
  gap: number,
  blocked: (c: Rect) => boolean = (c) => obstacles.some((o) => rectsOverlap(c, o, gap - 1)),
): [number, number] {
  const hits = (x: number, y: number): boolean => blocked({ x, y, w: r.w, h: r.h });
  if (!hits(r.x, r.y)) return [0, 0];
  const xs = new Set<number>([r.x]), ys = new Set<number>([r.y]);
  for (const o of obstacles) {
    xs.add(o.x + o.w + gap); xs.add(o.x - gap - r.w);
    ys.add(o.y + o.h + gap); ys.add(o.y - gap - r.h);
  }
  const cands: [number, number, number][] = [];
  for (const x of xs) for (const y of ys) cands.push([Math.abs(x - r.x) + Math.abs(y - r.y), x, y]);
  cands.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  for (const [, x, y] of cands) if (!hits(x, y)) return [Math.round(x - r.x), Math.round(y - r.y)];
  // Unreachable in practice: below everything.
  const bottom = Math.max(...obstacles.map((o) => o.y + o.h));
  return [0, Math.round(bottom + gap - r.y)];
}

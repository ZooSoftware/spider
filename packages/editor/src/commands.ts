// Canvas commands: what a gesture does to the layout, as plain functions over the current
// scene (model + profile + layout). No DOM and no server: app.ts wires them to pointer events,
// saving and history. Gestures that change meaning (connect, delete, move into a container)
// are text edits from @spider/core instead.
import { edgeId, renameEdgeId, type Model } from "@spider/core";
import { DEFAULT_NODE_SIZE, type ResolvedProfile } from "@spider/profile-schema";
import {
  edgeLabelPos,
  fitContainers,
  moveSegment,
  routeEdges,
  segmentNormalAxis,
  sideOf,
  type EdgeLayout,
  type LayoutFile,
  type NodeLayout,
  type Point as LayoutPoint,
} from "@spider/layout";
import type { Point } from "./canvas.ts";

export interface Scene {
  model: Model;
  profile: ResolvedProfile;
  layout: LayoutFile;
}

export const MIN_NODE_W = 40;
export const MIN_NODE_H = 30;

export function isContainer(model: Model, id: string): boolean {
  const n = model.nodes.get(id);
  return !!n && (n.isContainer || n.children.length > 0);
}

/** Containers (or container kinds) can receive dropped nodes. */
export function acceptsChildren(s: Scene, id: string): boolean {
  const n = s.model.nodes.get(id);
  return !!n && (isContainer(s.model, id) || s.profile.nodes[n.kind]?.container === true);
}

/** A node and everything inside it. */
export function subtree(model: Model, id: string): string[] {
  const out = [id];
  for (const c of model.nodes.get(id)?.children ?? []) out.push(...subtree(model, c));
  return out;
}

/** Innermost container whose box contains `p`, ignoring `exclude`. */
export function containerAt(s: Scene, p: Point, exclude: Set<string> = new Set()): string | undefined {
  let best: string | undefined;
  let bestArea = Infinity;
  for (const [id, n] of Object.entries(s.layout.nodes)) {
    if (exclude.has(id) || !acceptsChildren(s, id)) continue;
    if (p.x < n.x || p.x > n.x + n.w || p.y < n.y || p.y > n.y + n.h) continue;
    if (n.w * n.h < bestArea) {
      best = id;
      bestArea = n.w * n.h;
    }
  }
  return best;
}

/** Re-fit containers to their children (skipped while dragging) and re-route every line. */
export function relayout(s: Scene, fit = true): void {
  if (fit) fitContainers(s.model, s.profile, s.layout.nodes);
  s.layout.edges = routeEdges(s.model, s.profile, s.layout.nodes, s.layout.edges);
}

/** Move nodes by (dx, dy) from their boxes at drag start. */
export function moveNodes(layout: LayoutFile, orig: Map<string, NodeLayout>, dx: number, dy: number): void {
  for (const [id, o] of orig) layout.nodes[id] = { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
}

/**
 * Resize from the box at drag start and pin. Containers fit their children, so for them the
 * handle sets a minimum size instead (never below the content).
 */
export function resizeNode(s: Scene, id: string, orig: NodeLayout, dx: number, dy: number): void {
  const w = Math.max(MIN_NODE_W, Math.round(orig.w + dx));
  const h = Math.max(MIN_NODE_H, Math.round(orig.h + dy));
  s.layout.nodes[id] = isContainer(s.model, id) ? { ...orig, minW: w, minH: h, pinned: true } : { ...orig, w, h, pinned: true };
}

/** End of a container resize: a minimum dragged back down to (or below) the content is dropped. */
export function dropRedundantMin(s: Scene, id: string): void {
  const c = s.layout.nodes[id];
  if (!c || !isContainer(s.model, id) || c.minW === undefined || c.minH === undefined) return;
  const probe = { ...s.layout.nodes, [id]: { ...c, minW: undefined, minH: undefined } };
  fitContainers(s.model, s.profile, probe);
  if (c.minW <= probe[id]!.w) delete c.minW;
  if (c.minH <= probe[id]!.h) delete c.minH;
}

/** A hand-routed line through `points` (label placed again on the new route). */
export function manualEdge(model: Model, id: string, orig: EdgeLayout, points: LayoutPoint[]): EdgeLayout {
  const next: EdgeLayout = { ...orig, points, manual: true };
  delete next.labelPos;
  const lp = model.edges.get(id)?.label ? edgeLabelPos(points) : undefined;
  if (lp) next.labelPos = lp;
  return next;
}

/** Copy of a line's layout, kept as the starting point of a drag. */
export const edgeSnapshot = (e: EdgeLayout): EdgeLayout => ({ ...e, points: e.points.map((p) => [p[0], p[1]] as LayoutPoint) });

/** Drag segment `k` of a line sideways to `pointer`; the route becomes manual. */
export function dragSegment(s: Scene, id: string, orig: EdgeLayout, k: number, pointer: Point): void {
  const edge = s.model.edges.get(id);
  const src = edge && s.layout.nodes[edge.source], tgt = edge && s.layout.nodes[edge.target];
  if (!src || !tgt) return;
  const ax = segmentNormalAxis(orig.points[k]!, orig.points[k + 1]!);
  s.layout.edges[id] = manualEdge(s.model, id, orig, moveSegment(orig.points, k, pointer[ax === 0 ? "x" : "y"], src, tgt));
}

/**
 * Drag one end of a line. Along the same side of its node: the end slides (manual route).
 * Onto another side: that side becomes the line's port and the line routes automatically.
 */
export function dragEnd(s: Scene, id: string, orig: EdgeLayout, end: "source" | "target", pointer: Point): void {
  const edge = s.model.edges.get(id);
  const box = edge && s.layout.nodes[end === "source" ? edge.source : edge.target];
  if (!edge || !box) return;
  const P = orig.points;
  const endPt = end === "source" ? P[0]! : P[P.length - 1]!;
  const wanted = sideOf(box, [pointer.x, pointer.y]);
  if (wanted === sideOf(box, endPt) && P.length >= 2) {
    const k = end === "source" ? 0 : P.length - 2;
    dragSegment(s, id, orig, k, pointer);
    return;
  }
  const next: EdgeLayout = { points: P };
  const otherPort = end === "source" ? orig.targetPort : orig.sourcePort;
  if (end === "source") next.sourcePort = wanted;
  else next.targetPort = wanted;
  if (otherPort) {
    if (end === "source") next.targetPort = otherPort;
    else next.sourcePort = otherPort;
  }
  s.layout.edges[id] = next;
  s.layout.edges = routeEdges(s.model, s.profile, s.layout.nodes, s.layout.edges);
}

/** Back to automatic routing for one line (drops manual points and ports). */
export function resetRoute(s: Scene, id: string): boolean {
  const e = s.layout.edges[id];
  if (!e) return false;
  s.layout.edges[id] = { points: e.points };
  s.layout.edges = routeEdges(s.model, s.profile, s.layout.nodes, s.layout.edges);
  return true;
}

/** Whether a line has anything "Reset route" would drop. */
export const hasCustomRoute = (e: EdgeLayout | undefined): boolean => !!(e?.manual || e?.sourcePort || e?.targetPort);

/** Unpin one node, or every node. */
export function unpin(layout: LayoutFile, id?: string): void {
  for (const k of id ? [id] : Object.keys(layout.nodes)) {
    const n = layout.nodes[k];
    if (n) delete n.pinned;
  }
}

/** The layout re-keyed for an id rename, so the node keeps its place and its lines their routes. */
export function renameInLayout(layout: LayoutFile, from: string, to: string): LayoutFile {
  const nodes: Record<string, NodeLayout> = {};
  for (const [k, v] of Object.entries(layout.nodes)) nodes[k === from ? to : k] = v;
  const edges: Record<string, EdgeLayout> = {};
  for (const [k, v] of Object.entries(layout.edges)) edges[renameEdgeId(k, from, to)] = v;
  return { ...layout, nodes, edges };
}

/** Id of the line `addEdge(from, to)` creates next (`a->b`, then `a->b#2`, …). */
export function nextEdgeId(model: Model, from: string, to: string): string {
  const ordinal = [...model.edges.values()].filter((e) => e.source === from && e.target === to).length + 1;
  return edgeId(from, to, ordinal);
}

/** Box of a node dropped from the palette, centred on `p`, pinned. */
export function droppedNodeBox(profile: ResolvedProfile, kind: string, p: Point): NodeLayout {
  const [w, h] = profile.nodes[kind]?.size ?? DEFAULT_NODE_SIZE;
  return { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, pinned: true };
}

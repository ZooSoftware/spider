// Geometry primitives and sizing rules shared by placement, routing and rendering.
import type { Diagnostic, Model, ModelNode } from "@spider/core";
import { DEFAULT_NODE_SIZE, type ResolvedNodeKind, type ResolvedProfile, type Side } from "@spider/profile-schema";
import type { NodeLayout } from "./layout-file.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Vertical space reserved under a node whose kind has `label: "below"`. */
export const LABEL_BELOW_SPACE = 24;
/** Inner padding of containers (left/right/bottom). */
export const CONTAINER_PADDING = 20;
/** Extra top padding of containers, room for the container title. */
export const CONTAINER_TITLE_SPACE = 36;
/** Default size of an empty container. */
export const DEFAULT_CONTAINER_SIZE: [number, number] = [200, 120];

export const SIDES: readonly Side[] = ["right", "bottom", "left", "top"];

export function kindOf(profile: ResolvedProfile, node: ModelNode): ResolvedNodeKind | undefined {
  return profile.nodes[node.kind];
}

export function isContainer(node: ModelNode): boolean {
  return node.isContainer || node.children.length > 0;
}

/** Default [w, h] of a node's shape (without reserved label space). */
export function nodeSize(profile: ResolvedProfile, node: ModelNode): [number, number] {
  const size = kindOf(profile, node)?.size;
  if (size) return [size[0], size[1]];
  return isContainer(node) ? [...DEFAULT_CONTAINER_SIZE] : [...DEFAULT_NODE_SIZE];
}

/** Space reserved below the shape for an outside label. */
export function labelSpace(profile: ResolvedProfile, node: ModelNode): number {
  return !isContainer(node) && kindOf(profile, node)?.label === "below" ? LABEL_BELOW_SPACE : 0;
}

/** Box occupied by a node incl. its outside label. */
export function occupiedRect(profile: ResolvedProfile, node: ModelNode, l: Rect): Rect {
  return { x: l.x, y: l.y, w: l.w, h: l.h + labelSpace(profile, node) };
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** Ids of all ancestors of a node, nearest first. */
export function ancestors(model: Model, id: string): string[] {
  const out: string[] = [];
  let p = model.nodes.get(id)?.parent;
  while (p !== undefined && !out.includes(p)) {
    out.push(p);
    p = model.nodes.get(p)?.parent;
  }
  return out;
}

/** Leaf-first (post-order) list of container ids, so children are fitted before parents. */
export function containersBottomUp(model: Model): string[] {
  const out: string[] = [];
  const visit = (id: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = model.nodes.get(id);
    if (!n) return;
    for (const c of n.children) visit(c, seen);
    if (isContainer(n)) out.push(id);
  };
  const seen = new Set<string>();
  for (const id of model.nodes.keys()) visit(id, seen);
  return out;
}

/**
 * Fit every container exactly around its children (+ padding, + title space), so it grows
 * and shrinks with its content, pinned or not. A user-set minimum size (minW/minH) only adds
 * room to the right/bottom. Empty containers keep their box. Mutates and returns `nodes`.
 */
export function fitContainers(
  model: Model,
  profile: ResolvedProfile,
  nodes: Record<string, NodeLayout>,
): Record<string, NodeLayout> {
  for (const id of containersBottomUp(model)) {
    const n = model.nodes.get(id);
    if (!n) continue;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of n.children) {
      const cl = nodes[c];
      const cn = model.nodes.get(c);
      if (!cl || !cn) continue;
      const r = occupiedRect(profile, cn, cl);
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
      x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
    }
    const cur = nodes[id];
    if (x1 === Infinity) {
      if (!cur) continue;
      nodes[id] = { ...cur };
      continue;
    }
    const w = x2 - x1 + 2 * CONTAINER_PADDING;
    const h = y2 - y1 + CONTAINER_TITLE_SPACE + CONTAINER_PADDING;
    const out: NodeLayout = {
      x: Math.round(x1 - CONTAINER_PADDING),
      y: Math.round(y1 - CONTAINER_TITLE_SPACE),
      w: Math.round(Math.max(w, cur?.minW ?? 0)),
      h: Math.round(Math.max(h, cur?.minH ?? 0)),
    };
    if (cur?.pinned) out.pinned = true;
    if (cur?.minW) out.minW = cur.minW;
    if (cur?.minH) out.minH = cur.minH;
    nodes[id] = out;
  }
  return nodes;
}

/** Overlaps as user-facing warnings (spans point at the overlapping node). */
export function containerOverlapDiagnostics(model: Model, profile: ResolvedProfile, nodes: Record<string, NodeLayout>): Diagnostic[] {
  return containerOverlaps(model, profile, nodes).map(({ node, container }) => ({
    severity: "warning",
    code: "layout/overlaps-container",
    message: `"${node}" is drawn over "${container}" but is not inside it; drag it out of the box, or into it to make it a child`,
    span: model.nodes.get(node)?.span,
  }));
}

export interface ContainerOverlap {
  /** The node drawn under a container it doesn't belong to. */
  node: string;
  container: string;
}

/**
 * Nodes whose box overlaps a container they are not inside (and that is not inside them).
 * These are shown to the user, never moved automatically.
 */
export function containerOverlaps(model: Model, profile: ResolvedProfile, nodes: Record<string, NodeLayout>): ContainerOverlap[] {
  const out: ContainerOverlap[] = [];
  const containers = [...model.nodes.values()].filter((n) => isContainer(n) && nodes[n.id]);
  for (const node of model.nodes.values()) {
    const l = nodes[node.id];
    if (!l) continue;
    const r = occupiedRect(profile, node, l);
    const anc = new Set(ancestors(model, node.id));
    for (const c of containers) {
      if (c.id === node.id || anc.has(c.id) || ancestors(model, c.id).includes(node.id)) continue;
      if (rectsOverlap(r, nodes[c.id]!)) out.push({ node: node.id, container: c.id });
    }
  }
  return out;
}

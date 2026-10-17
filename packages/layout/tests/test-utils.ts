// Hand-built Model / ResolvedProfile fixtures and geometry checks for tests and preview scripts
// (the parser and profile loader live in other packages). Not exported from index.ts.
import type { Model, ModelEdge, ModelNode } from "@spider/core";
import type { LayoutDefaults, ResolvedNodeKind, ResolvedProfile } from "@spider/profile-schema";
import type { Rect } from "../src/geometry.ts";
import type { LayoutFile, Point } from "../src/layout-file.ts";

export interface NodeSpec {
  id: string;
  kind?: string;
  parent?: string;
  label?: string;
  container?: boolean;
}

export type EdgeSpec = [source: string, target: string, label?: string];

export function buildModel(nodes: (string | NodeSpec)[], edges: EdgeSpec[] = []): Model {
  const span = { start: 0, end: 0 };
  const model: Model = { uses: [], nodes: new Map(), edges: new Map(), roots: [] };
  for (const raw of nodes) {
    const s = typeof raw === "string" ? { id: raw } : raw;
    const n: ModelNode = { id: s.id, kind: s.kind ?? "service", props: {}, children: [], isContainer: s.container ?? false, span };
    if (s.label) n.label = s.label;
    if (s.parent) n.parent = s.parent;
    model.nodes.set(s.id, n);
  }
  for (const n of model.nodes.values()) {
    const p = n.parent !== undefined ? model.nodes.get(n.parent) : undefined;
    if (p) {
      p.children.push(n.id);
      p.isContainer = true;
    } else model.roots.push(n.id);
  }
  const count = new Map<string, number>();
  for (const [source, target, label] of edges) {
    const k = `${source}->${target}`;
    const ord = (count.get(k) ?? 0) + 1;
    count.set(k, ord);
    const e: ModelEdge = { id: ord === 1 ? k : `${k}#${ord}`, source, target, span };
    if (label) e.label = label;
    model.edges.set(e.id, e);
  }
  return model;
}

export function buildProfile(
  kinds: Record<string, Omit<ResolvedNodeKind, "kind">> = {},
  layout: LayoutDefaults = {},
): ResolvedProfile {
  const nodes: Record<string, ResolvedNodeKind> = {};
  for (const [k, v] of Object.entries(kinds)) nodes[k] = { ...v, kind: k };
  return { sources: [], nodes, edges: {}, rules: [], theme: {}, layout };
}

/** Does the axis-aligned segment p-q pass through the open interior of r? */
export function segmentCrossesRect(p: Point, q: Point, r: Rect): boolean {
  const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]);
  const y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
  return x2 > r.x && x1 < r.x + r.w && y2 > r.y && y1 < r.y + r.h;
}

/** Crude debug SVG: node boxes, ids, polylines. */
export function debugSvg(model: Model, layout: LayoutFile): string {
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  const add = (x: number, y: number): void => {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  };
  for (const n of Object.values(layout.nodes)) { add(n.x, n.y); add(n.x + n.w, n.y + n.h); }
  for (const e of Object.values(layout.edges)) for (const p of e.points) add(p[0], p[1]);
  const [vx, vy, vw, vh] = [x1 - 20, y1 - 20, x2 - x1 + 40, y2 - y1 + 40];
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" font-family="sans-serif" font-size="12">`,
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="white"/>`,
  ];
  const colors = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080", "#9a6324", "#800000", "#000075", "#808000"];
  for (const [id, n] of Object.entries(layout.nodes)) {
    const c = model.nodes.get(id)?.children.length ?? 0;
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${c ? "#f4f6fb" : "#fff"}" stroke="${n.pinned ? "#c00" : "#555"}" ${c ? 'stroke-dasharray="6 3"' : ""}/>`);
    out.push(c ? `<text x="${n.x + 8}" y="${n.y + 18}" font-weight="bold">${id}</text>` : `<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 4}" text-anchor="middle">${id}</text>`);
  }
  let i = 0;
  for (const [id, e] of Object.entries(layout.edges)) {
    const col = colors[i++ % colors.length];
    out.push(`<polyline points="${e.points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    const last = e.points[e.points.length - 1]!;
    out.push(`<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${col}"/>`);
    if (e.labelPos) out.push(`<text x="${e.labelPos[0]}" y="${e.labelPos[1] - 3}" fill="${col}" font-size="10" text-anchor="middle">${model.edges.get(id)?.label ?? ""}</text>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

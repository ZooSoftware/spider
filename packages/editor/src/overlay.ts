// Editor overlay drawn on top of the rendered diagram: pins, overlap warnings, drop target,
// manual-route markers, selection with its handles, and the connection being drawn.
// Plain SVG markup; the canvas finds handles by their classes and data attributes.
import { containerOverlaps, edgeLabelPos, segmentNormalAxis, type NodeLayout } from "@spider/layout";
import type { Point, Target } from "./canvas.ts";
import type { Scene } from "./commands.ts";

export interface OverlayState {
  selected: Target | undefined;
  /** Container highlighted as drop target while dragging a node. */
  dropTarget: string | undefined;
  /** Connection being drawn from a node's connect handle. */
  connect: { from: string; pointer: Point; over: string | undefined } | undefined;
}

const box = (n: NodeLayout, pad: number, cls: string): string =>
  `<rect class="${cls}" x="${n.x - pad}" y="${n.y - pad}" width="${n.w + 2 * pad}" height="${n.h + 2 * pad}" rx="6"/>`;

export function overlay(s: Scene, ui: OverlayState): string {
  const parts: string[] = [];
  const nodes = s.layout.nodes;
  for (const n of Object.values(nodes)) {
    if (n.pinned) parts.push(`<circle class="spd-pin" cx="${n.x + n.w - 1}" cy="${n.y + 1}" r="3.5"><title>pinned</title></circle>`);
  }
  for (const { node, container } of containerOverlaps(s.model, s.profile, nodes)) {
    const n = nodes[node];
    if (n) parts.push(box(n, 5, "spd-warn").replace("/>", `><title>Overlaps "${container}" but is not inside it: drag it out, or into it</title></rect>`));
  }
  const drop = ui.dropTarget ? nodes[ui.dropTarget] : undefined;
  if (drop) parts.push(box(drop, 3, "spd-drop"));
  const sel = ui.selected;
  // Hand-routed lines get a small marker on their first bend (or middle).
  for (const [id, e] of Object.entries(s.layout.edges)) {
    if (!e.manual || id === sel?.id) continue;
    const m = e.points[1] && e.points.length > 2 ? e.points[1] : edgeLabelPos(e.points);
    if (m) parts.push(`<rect class="spd-manual" x="${m[0] - 3}" y="${m[1] - 3}" width="6" height="6" transform="rotate(45 ${m[0]} ${m[1]})"><title>manual route (R to reset)</title></rect>`);
  }
  if (sel?.type === "edge") {
    const pts = s.layout.edges[sel.id]?.points ?? [];
    if (pts.length) {
      parts.push(`<polyline class="spd-sel-edge" points="${pts.map((p) => p.join(",")).join(" ")}"/>`);
      // A handle in the middle of each segment: drag sideways to move it.
      for (let k = 0; k + 1 < pts.length; k++) {
        const [a, b] = [pts[k]!, pts[k + 1]!];
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        const vertical = segmentNormalAxis(a, b) === 0;
        const w = vertical ? 6 : 14, h = vertical ? 14 : 6;
        parts.push(`<rect class="spd-seg ${vertical ? "v" : "h"}" data-id="${sel.id}" data-k="${k}" x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="2"/>`);
      }
      // Handles on both ends: drag along the side, or onto another side of the node.
      for (const [end, p] of [["source", pts[0]!], ["target", pts[pts.length - 1]!]] as const) {
        parts.push(`<circle class="spd-end" data-id="${sel.id}" data-end="${end}" cx="${p[0]}" cy="${p[1]}" r="5"/>`);
      }
    }
  } else if (sel?.type === "node" && nodes[sel.id]) {
    const n = nodes[sel.id]!;
    parts.push(box(n, 4, "spd-sel"));
    parts.push(`<rect class="spd-handle" data-id="${sel.id}" x="${n.x + n.w - 1}" y="${n.y + n.h - 1}" width="9" height="9" rx="2"/>`);
    if (!ui.connect) {
      parts.push(
        `<g class="spd-connect" data-id="${sel.id}"><title>drag to connect</title><circle cx="${n.x + n.w + 14}" cy="${n.y + n.h / 2}" r="7"/><path d="M${n.x + n.w + 10} ${n.y + n.h / 2}h8M${n.x + n.w + 14} ${n.y + n.h / 2 - 4}v8"/></g>`,
      );
    }
  }
  const c = ui.connect;
  if (c && nodes[c.from]) {
    const src = nodes[c.from]!;
    if (c.over && c.over !== c.from && nodes[c.over]) parts.push(box(nodes[c.over]!, 3, "spd-drop"));
    parts.push(`<line class="spd-preview" x1="${src.x + src.w / 2}" y1="${src.y + src.h / 2}" x2="${c.pointer.x}" y2="${c.pointer.y}"/>`);
  }
  return `<g class="spd-overlay">${parts.join("")}</g>`;
}

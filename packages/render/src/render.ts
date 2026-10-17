// Model + layout + profile → standalone SVG. The same output is used for CLI export and as
// the editor canvas, so elements carry `data-id` attributes for hit testing.
import type { Model, ModelEdge, ModelNode } from "@spider/core";
import { DEFAULT_NODE_SIZE, type ResolvedProfile, type Theme } from "@spider/profile-schema";
import { LABEL_BELOW_SPACE, type LayoutFile, type NodeLayout, type Point } from "@spider/layout";
import { shapeSvg, snapToOutline, type Paint } from "./shapes.ts";
import { embedIcon, esc, n, textWidth, wrap } from "./svg.ts";

export interface RenderOptions {
  /** Space around the drawing. */
  padding?: number;
  /** Add invisible wide strokes on edges for hit testing (editor canvas). */
  interactive?: boolean;
}

const DEFAULT_THEME: Required<Theme> = {
  background: "#ffffff",
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: 13,
  nodeFill: "#ffffff",
  nodeStroke: "#94a3b8",
  textColor: "#0f172a",
  edgeColor: "#64748b",
  containerFill: "#f8fafc",
  containerStroke: "#cbd5e1",
};
const MUTED = "#64748b";
const UNKNOWN_STROKE = "#f59e0b";
const ICON = 20;
const CORNER = 6;

interface Ctx {
  model: Model;
  profile: ResolvedProfile;
  layout: LayoutFile;
  theme: Required<Theme>;
  markers: Map<string, string>;
  interactive: boolean;
}

export function renderSvg(model: Model, profile: ResolvedProfile, layout: LayoutFile, opts: RenderOptions = {}): string {
  const theme = { ...DEFAULT_THEME, ...profile.theme } as Required<Theme>;
  const ctx: Ctx = { model, profile, layout, theme, markers: new Map(), interactive: opts.interactive ?? false };
  const pad = opts.padding ?? 24;

  const containers: string[] = [];
  const leaves: string[] = [];
  for (const node of byDepth(model)) {
    const l = layout.nodes[node.id];
    if (!l) continue;
    (isContainer(node) ? containers : leaves).push(node.id);
  }
  const edges = [...model.edges.values()].filter((e) => (layout.edges[e.id]?.points.length ?? 0) >= 2);

  const body = [
    ...containers.map((id) => renderContainer(ctx, model.nodes.get(id)!)),
    ...edges.map((e) => renderEdge(ctx, e)),
    ...leaves.map((id) => renderNode(ctx, model.nodes.get(id)!)),
    ...edges.map((e) => renderEdgeLabel(ctx, e)),
  ].join("\n");

  const b = bounds(ctx);
  const x0 = b.x - pad;
  const y0 = b.y - pad;
  const w = b.w + 2 * pad;
  const h = b.h + 2 * pad;
  const defs = [...ctx.markers.values()].join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${n(x0)} ${n(y0)} ${n(w)} ${n(h)}" font-family="${esc(theme.fontFamily)}" font-size="${theme.fontSize}">`,
    `<defs>${defs}</defs>`,
    `<rect class="spd-bg" x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" fill="${theme.background}"/>`,
    body,
    `</svg>`,
  ].join("\n");
}

function isContainer(node: ModelNode): boolean {
  return node.isContainer || node.children.length > 0;
}

/** Nodes ordered parents-first, so nested containers paint over their parents. */
function byDepth(model: Model): ModelNode[] {
  const depth = (node: ModelNode): number => {
    let d = 0;
    for (let p = node.parent; p !== undefined && d < 64; p = model.nodes.get(p)?.parent) d++;
    return d;
  };
  return [...model.nodes.values()].map((node, i) => ({ node, d: depth(node), i })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.node);
}

function paintFor(ctx: Ctx, node: ModelNode, container: boolean): Paint {
  const kind = ctx.profile.nodes[node.kind];
  const known = kind !== undefined || Object.keys(ctx.profile.nodes).length === 0;
  const s = kind?.style ?? {};
  return {
    fill: s.fill ?? (container ? ctx.theme.containerFill : ctx.theme.nodeFill),
    stroke: known ? (s.stroke ?? (container ? ctx.theme.containerStroke : ctx.theme.nodeStroke)) : UNKNOWN_STROKE,
    strokeWidth: s.strokeWidth ?? 1.5,
    dashed: s.dashed ?? !known,
  };
}

function renderContainer(ctx: Ctx, node: ModelNode): string {
  const l = ctx.layout.nodes[node.id]!;
  const kind = ctx.profile.nodes[node.kind];
  const paint = paintFor(ctx, node, true);
  const title = node.label ?? node.id;
  const iconSize = 16;
  const icon = kind?.iconSvg ? embedIcon(kind.iconSvg, l.x + 12, l.y + 11, iconSize, paint.stroke === ctx.theme.containerStroke ? MUTED : paint.stroke) : "";
  const tx = l.x + 12 + (icon ? iconSize + 6 : 0);
  return (
    `<g class="spd-node spd-container" data-id="${esc(node.id)}">` +
    shapeSvg(kind?.shape === "rounded" ? "rounded" : "rect", l.x, l.y, l.w, l.h, paint) +
    icon +
    `<text x="${n(tx)}" y="${n(l.y + 24)}" fill="${kind?.style?.textColor ?? ctx.theme.textColor}" font-weight="600">${esc(title)}</text>` +
    `</g>`
  );
}

/** Content scale of a resized node: its size vs. the kind's default size, clamped. */
export function contentScale(l: { w: number; h: number }, defaultSize: [number, number]): number {
  const s = Math.min(l.w / defaultSize[0], l.h / defaultSize[1]);
  return Math.min(2, Math.max(0.75, s));
}

function renderNode(ctx: Ctx, node: ModelNode): string {
  const l = ctx.layout.nodes[node.id]!;
  const kind = ctx.profile.nodes[node.kind];
  const paint = paintFor(ctx, node, false);
  const color = kind?.style?.textColor ?? ctx.theme.textColor;
  // Text, icon and padding grow/shrink with the box when a node is resized.
  const s = contentScale(l, kind?.size ?? DEFAULT_NODE_SIZE);
  const fs = ctx.theme.fontSize * s;
  const iconSize = ICON * s;
  const label = node.label ?? node.id;
  const sub = subtitle(ctx, node);
  const parts = [`<g class="spd-node" data-id="${esc(node.id)}">`, shapeSvg(kind?.shape, l.x, l.y, l.w, l.h, paint)];

  if (kind?.label === "below") {
    parts.push(textBlock(wrap(label, fs, l.w + 60 * s, 2), l.x + l.w / 2, l.y + l.h + fs + 3, "middle", color, fs, true));
  } else {
    const iconColor = paint.stroke === ctx.theme.nodeStroke ? MUTED : paint.stroke;
    const roomy = kind?.shape !== "diamond" && kind?.shape !== "circle" && l.w >= 100 * s;
    const icon = roomy && kind?.iconSvg ? kind.iconSvg : undefined;
    const inset = (kind?.shape === "hexagon" || kind?.shape === "parallelogram" ? 16 : kind?.shape === "diamond" ? l.w / 5 / s : 10) * s;
    const textLeft = l.x + inset + (icon ? iconSize + 8 * s : 0);
    const textW = l.x + l.w - inset - textLeft;
    const lines = wrap(label, fs, textW, sub ? 2 : 3);
    const block = lines.length * fs * 1.25 + (sub ? fs : 0);
    const top = l.y + (kind?.label === "top" ? 10 * s : (l.h - block) / 2);
    if (icon) parts.push(embedIcon(icon, l.x + inset, l.y + (l.h - iconSize) / 2, iconSize, iconColor));
    const anchor = icon ? "start" : "middle";
    const tx = icon ? textLeft : l.x + l.w / 2;
    parts.push(textBlock(lines, tx, top + fs, anchor, color, fs, true));
    if (sub) parts.push(`<text x="${n(tx)}" y="${n(top + lines.length * fs * 1.25 + fs * 0.85)}" text-anchor="${anchor}" fill="${MUTED}" font-size="${n(fs * 0.8)}">${esc(sub)}</text>`);
  }
  parts.push(`</g>`);
  return parts.join("");
}

/** Muted second line: `tech` prop if any; the raw kind for kinds the profile doesn't know. */
function subtitle(ctx: Ctx, node: ModelNode): string | undefined {
  const tech = node.props.tech;
  if (typeof tech === "string" && tech) return tech;
  if (Object.keys(ctx.profile.nodes).length > 0 && !ctx.profile.nodes[node.kind]) return `${node.kind} (unknown)`;
  return undefined;
}

function textBlock(lines: string[], x: number, y: number, anchor: string, color: string, fs: number, bold: boolean): string {
  const tspans = lines.map((t, i) => `<tspan x="${n(x)}" dy="${i === 0 ? 0 : n(fs * 1.25)}">${esc(t)}</tspan>`).join("");
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" fill="${color}" font-size="${n(fs)}"${bold ? ' font-weight="500"' : ""}>${tspans}</text>`;
}

function edgeStyle(ctx: Ctx, edge: ModelEdge) {
  const kindName = edge.kind ?? ctx.profile.defaultEdge;
  const kind = kindName ? ctx.profile.edges[kindName] : undefined;
  return {
    color: kind?.color ?? ctx.theme.edgeColor,
    dash: kind?.style === "dashed" ? "6 4" : kind?.style === "dotted" ? "1.5 3.5" : undefined,
    arrow: kind?.arrow ?? "end",
  };
}

function marker(ctx: Ctx, color: string, start: boolean): string {
  const id = `spd-arrow-${start ? "s" : "e"}-${color.replace(/[^\w]/g, "")}`;
  if (!ctx.markers.has(id)) {
    const path = start ? "M10 0 L0 5 L10 10 Z" : "M0 0 L10 5 L0 10 Z";
    ctx.markers.set(
      id,
      `<marker id="${id}" viewBox="0 0 10 10" refX="${start ? 0 : 10}" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="${path}" fill="${color}"/></marker>`,
    );
  }
  return `url(#${id})`;
}

function renderEdge(ctx: Ctx, edge: ModelEdge): string {
  const pts = snapEnds(ctx, edge, ctx.layout.edges[edge.id]!.points);
  const st = edgeStyle(ctx, edge);
  const attrs = [
    `d="${roundedPath(pts, CORNER)}"`,
    `fill="none"`,
    `stroke="${st.color}"`,
    `stroke-width="1.5"`,
    `stroke-linejoin="round"`,
    st.dash ? `stroke-dasharray="${st.dash}"` : "",
    st.arrow === "end" || st.arrow === "both" ? `marker-end="${marker(ctx, st.color, false)}"` : "",
    st.arrow === "start" || st.arrow === "both" ? `marker-start="${marker(ctx, st.color, true)}"` : "",
  ].filter(Boolean);
  const hit = ctx.interactive ? `<path class="spd-hit" d="${roundedPath(pts, CORNER)}" fill="none" stroke="transparent" stroke-width="12"/>` : "";
  return `<g class="spd-edge" data-id="${esc(edge.id)}"><path ${attrs.join(" ")}/>${hit}</g>`;
}

/** Endpoints are routed to box boundaries; pull them onto non-rectangular outlines. */
function snapEnds(ctx: Ctx, edge: ModelEdge, pts: Point[]): Point[] {
  if (pts.length < 2) return pts;
  const out = pts.slice();
  const ends: [number, string][] = [
    [0, edge.source],
    [out.length - 1, edge.target],
  ];
  for (const [i, id] of ends) {
    const node = ctx.model.nodes.get(id);
    const box = ctx.layout.nodes[id];
    if (!node || !box || isContainer(node)) continue;
    out[i] = snapToOutline(ctx.profile.nodes[node.kind]?.shape, box, out[i]!);
  }
  return out;
}

function renderEdgeLabel(ctx: Ctx, edge: ModelEdge): string {
  const el = ctx.layout.edges[edge.id]!;
  if (!edge.label || !el.labelPos) return "";
  const fs = ctx.theme.fontSize * 0.85;
  const [x, y] = el.labelPos;
  const w = textWidth(edge.label, fs) + 8;
  const h = fs + 6;
  return (
    `<g class="spd-edge-label" data-id="${esc(edge.id)}">` +
    `<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${ctx.theme.background}" fill-opacity="0.9"/>` +
    `<text x="${n(x)}" y="${n(y + fs * 0.35)}" text-anchor="middle" fill="${edgeStyle(ctx, edge).color}" font-size="${n(fs)}">${esc(edge.label)}</text>` +
    `</g>`
  );
}

/** Orthogonal polyline with small rounded corners. */
export function roundedPath(pts: Point[], radius: number): string {
  const [first] = pts;
  if (!first) return "";
  let d = `M${n(first[0])} ${n(first[1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [cx, cy] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const r = Math.min(radius, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx - Math.sign(cx - px) * r;
    const ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r;
    const by = cy + Math.sign(ny - cy) * r;
    d += ` L${n(ax)} ${n(ay)} Q${n(cx)} ${n(cy)} ${n(bx)} ${n(by)}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d} L${n(last[0])} ${n(last[1])}`;
}

function bounds(ctx: Ctx): NodeLayout {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const add = (x: number, y: number): void => {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  };
  for (const node of ctx.model.nodes.values()) {
    const l = ctx.layout.nodes[node.id];
    if (!l) continue;
    const below = ctx.profile.nodes[node.kind]?.label === "below" && !isContainer(node);
    add(l.x - (below ? 30 : 0), l.y);
    add(l.x + l.w + (below ? 30 : 0), l.y + l.h + (below ? LABEL_BELOW_SPACE + 14 : 0));
  }
  for (const edge of ctx.model.edges.values()) {
    const el = ctx.layout.edges[edge.id];
    for (const [x, y] of el?.points ?? []) add(x, y);
    if (edge.label && el?.labelPos) {
      const w = textWidth(edge.label, ctx.theme.fontSize * 0.85) / 2 + 6;
      add(el.labelPos[0] - w, el.labelPos[1] - 10);
      add(el.labelPos[0] + w, el.labelPos[1] + 10);
    }
  }
  if (x1 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

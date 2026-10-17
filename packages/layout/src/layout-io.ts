// Layout sidecar IO: orphan cleanup, tolerant parsing with diagnostics, stable serialization
// (model order, one entry per line so git diffs stay small).
import type { Diagnostic, Model } from "@spider/core";
import type { Side } from "@spider/profile-schema";
import { emptyLayout, type EdgeLayout, type LayoutFile, type NodeLayout, type Point } from "./layout-file.ts";

/** Drop layout entries whose ids are not in the model; keep the rest (in model order). */
export function reconcileLayout(model: Model, layout: LayoutFile): LayoutFile {
  const out = emptyLayout();
  for (const id of model.nodes.keys()) {
    const n = layout.nodes[id];
    if (n) out.nodes[id] = n;
  }
  for (const id of model.edges.keys()) {
    const e = layout.edges[id];
    if (e) out.edges[id] = e;
  }
  return out;
}

const SIDES = new Set<string>(["left", "right", "top", "bottom"]);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

export function parseLayoutFile(json: string): { layout: LayoutFile; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const warn = (code: string, message: string): void => {
    diagnostics.push({ severity: "warning", code: `layout/${code}`, message });
  };
  const layout = emptyLayout();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    diagnostics.push({ severity: "error", code: "layout/invalid-json", message: `Invalid layout JSON: ${(e as Error).message}` });
    return { layout, diagnostics };
  }
  if (!isObj(raw)) {
    diagnostics.push({ severity: "error", code: "layout/invalid-file", message: "Layout file must be a JSON object" });
    return { layout, diagnostics };
  }
  if (raw.version !== 1) warn("version", `Unsupported layout version ${JSON.stringify(raw.version)}, reading as version 1`);

  for (const [id, v] of Object.entries(isObj(raw.nodes) ? raw.nodes : {})) {
    if (!isObj(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.w) || !isNum(v.h) || v.w <= 0 || v.h <= 0) {
      warn("invalid-node", `Ignoring invalid layout for node "${id}"`);
      continue;
    }
    const n: NodeLayout = { x: v.x, y: v.y, w: v.w, h: v.h };
    if (v.pinned === true) n.pinned = true;
    if (isNum(v.minW) && v.minW > 0) n.minW = v.minW;
    if (isNum(v.minH) && v.minH > 0) n.minH = v.minH;
    layout.nodes[id] = n;
  }
  for (const [id, v] of Object.entries(isObj(raw.edges) ? raw.edges : {})) {
    if (!isObj(v) || !Array.isArray(v.points) || !v.points.every(isPoint)) {
      warn("invalid-edge", `Ignoring invalid layout for edge "${id}"`);
      continue;
    }
    const e: EdgeLayout = { points: v.points.map((p: Point) => [p[0], p[1]] as Point) };
    if (v.manual === true) e.manual = true;
    if (typeof v.sourcePort === "string" && SIDES.has(v.sourcePort)) e.sourcePort = v.sourcePort as Side;
    if (typeof v.targetPort === "string" && SIDES.has(v.targetPort)) e.targetPort = v.targetPort as Side;
    if (isPoint(v.labelPos)) e.labelPos = [v.labelPos[0], v.labelPos[1]];
    layout.edges[id] = e;
  }
  return { layout, diagnostics };
}

function nodeJson(n: NodeLayout): string {
  const o: Record<string, unknown> = { x: n.x, y: n.y, w: n.w, h: n.h };
  if (n.pinned) o.pinned = true;
  if (n.minW) o.minW = n.minW;
  if (n.minH) o.minH = n.minH;
  return JSON.stringify(o);
}

function edgeJson(e: EdgeLayout): string {
  const o: Record<string, unknown> = { points: e.points };
  if (e.manual) o.manual = true;
  if (e.sourcePort) o.sourcePort = e.sourcePort;
  if (e.targetPort) o.targetPort = e.targetPort;
  if (e.labelPos) o.labelPos = e.labelPos;
  return JSON.stringify(o);
}

function section(name: string, entries: [string, string][]): string {
  if (entries.length === 0) return `  "${name}": {}`;
  return `  "${name}": {\n${entries.map(([k, v]) => `    ${JSON.stringify(k)}: ${v}`).join(",\n")}\n  }`;
}

/**
 * Serialize with one entry per line. Keys follow `model` order when given (unknown ids are
 * appended in their existing order), otherwise the layout's own insertion order.
 */
export function serializeLayoutFile(layout: LayoutFile, model?: Model): string {
  const order = (rec: Record<string, unknown>, ids: Iterable<string> | undefined): string[] => {
    if (!ids) return Object.keys(rec);
    const out = [...ids].filter((id) => id in rec);
    for (const k of Object.keys(rec)) if (!out.includes(k)) out.push(k);
    return out;
  };
  const nodes = order(layout.nodes, model?.nodes.keys()).map((k): [string, string] => [k, nodeJson(layout.nodes[k]!)]);
  const edges = order(layout.edges, model?.edges.keys()).map((k): [string, string] => [k, edgeJson(layout.edges[k]!)]);
  return `{\n  "version": 1,\n${section("nodes", nodes)},\n${section("edges", edges)}\n}\n`;
}

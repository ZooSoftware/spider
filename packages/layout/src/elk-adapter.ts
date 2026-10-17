// ELK adapter: model + profile hints -> hierarchical ELK graph -> absolute node rects.
// Only placement is taken from ELK; edge routes come from our own router (router/).
import type { Model } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  ancestors,
  CONTAINER_PADDING,
  CONTAINER_TITLE_SPACE,
  isContainer,
  kindOf,
  labelSpace,
  nodeSize,
  type Rect,
} from "./geometry.ts";

export const DEFAULT_NODE_SPACING = 50;
export const DEFAULT_LAYER_SPACING = 80;

let elk: InstanceType<typeof ELK> | undefined;

/**
 * elkjs' bundled build decides at construction time whether it runs inside a Web Worker by
 * checking `typeof document === "undefined" && typeof self !== "undefined"`. Bun defines
 * `self`, so we hide it while constructing to get the in-thread "fake worker".
 */
function getElk(): InstanceType<typeof ELK> {
  if (elk) return elk;
  const g = globalThis as { self?: unknown };
  const inBrowser = (globalThis as { document?: unknown }).document !== undefined;
  const desc = inBrowser ? undefined : Object.getOwnPropertyDescriptor(globalThis, "self");
  if (desc?.configurable) delete g.self;
  try {
    elk = new ELK();
  } finally {
    if (desc?.configurable) Object.defineProperty(globalThis, "self", desc);
  }
  return elk;
}

/** Spacing options; set on the root and on every container (ELK does not inherit them). */
function spacingOptions(profile: ResolvedProfile): Record<string, string> {
  const nodeSpacing = profile.layout.nodeSpacing ?? DEFAULT_NODE_SPACING;
  const layerSpacing = profile.layout.layerSpacing ?? DEFAULT_LAYER_SPACING;
  return {
    "elk.spacing.nodeNode": String(nodeSpacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
    "elk.spacing.edgeNode": String(Math.round(nodeSpacing / 2)),
    "elk.spacing.edgeEdge": "12",
    "elk.layered.spacing.edgeNodeBetweenLayers": String(Math.round(layerSpacing / 3)),
  };
}

function rootOptions(profile: ResolvedProfile): Record<string, string> {
  return {
    ...spacingOptions(profile),
    "elk.algorithm": "layered",
    "elk.direction": profile.layout.direction ?? "RIGHT",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.randomSeed": "1",
    "elk.padding": "[top=20,left=20,bottom=20,right=20]",
  };
}

/** Run ELK on the full model. Returns absolute rects (shape only, no label space) for every node. */
export async function elkPlace(model: Model, profile: ResolvedProfile): Promise<Record<string, Rect>> {
  const elkNodes = new Map<string, ElkNode>();
  const build = (id: string): ElkNode => {
    const n = model.nodes.get(id)!;
    const options: Record<string, string> = {};
    const layer = kindOf(profile, n)?.layout?.layer;
    if (layer) options["elk.layered.layering.layerConstraint"] = layer === "first" ? "FIRST" : "LAST";
    const en: ElkNode = { id, layoutOptions: options };
    const kids = n.children.filter((c) => model.nodes.has(c));
    if (isContainer(n) && kids.length > 0) {
      Object.assign(options, spacingOptions(profile));
      options["elk.padding"] =
        `[top=${CONTAINER_TITLE_SPACE},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`;
      en.children = kids.map(build);
      en.edges = [];
    } else {
      const [w, h] = nodeSize(profile, n);
      en.width = w;
      en.height = h + labelSpace(profile, n);
    }
    elkNodes.set(id, en);
    return en;
  };
  const root: ElkNode = {
    id: "__root__",
    layoutOptions: rootOptions(profile),
    children: model.roots.filter((r) => model.nodes.has(r)).map(build),
    edges: [],
  };
  // Nodes reachable from no root (malformed parent links) still get placed at top level.
  for (const id of model.nodes.keys()) if (!elkNodes.has(id)) root.children!.push(build(id));

  for (const e of model.edges.values()) {
    if (e.source === e.target || !elkNodes.has(e.source) || !elkNodes.has(e.target)) continue;
    const sa = ancestors(model, e.source), ta = ancestors(model, e.target);
    if (sa.includes(e.target) || ta.includes(e.source)) continue; // container <-> own descendant
    const lca = sa.find((a) => ta.includes(a));
    const owner = (lca !== undefined ? elkNodes.get(lca) : undefined) ?? root;
    const edge: ElkExtendedEdge = { id: e.id, sources: [e.source], targets: [e.target] };
    (owner.edges ??= []).push(edge);
  }

  const out = await getElk().layout(root);
  const rects: Record<string, Rect> = {};
  const collect = (en: ElkNode, ox: number, oy: number): void => {
    for (const c of en.children ?? []) {
      const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
      const n = model.nodes.get(c.id);
      const h = (c.height ?? 0) - (n ? labelSpace(profile, n) : 0);
      rects[c.id] = { x, y, w: c.width ?? 0, h };
      collect(c, x, y);
    }
  };
  collect(out, 0, 0);
  return rects;
}

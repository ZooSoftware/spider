// Shared contract: the profile file format (profile.yaml) and the resolved profile used by
// layout/render. Profiles are declarative data; built-in diagram types use this same format.
import { z } from "zod";

export const Side = z.enum(["left", "right", "top", "bottom"]);
export type Side = z.infer<typeof Side>;

export const Shape = z.enum([
  "rect", "rounded", "cylinder", "circle", "hexagon", "person", "cloud", "queue", "diamond", "parallelogram",
]);
export type Shape = z.infer<typeof Shape>;

export const PropType = z.enum(["string", "number", "boolean"]);

export const NodeStyle = z
  .object({
    fill: z.string(),
    stroke: z.string(),
    strokeWidth: z.number(),
    textColor: z.string(),
    dashed: z.boolean(),
  })
  .partial();

export const NodeKindDef = z
  .object({
    description: z.string(),
    /** Path to an SVG, relative to the profile folder. */
    icon: z.string(),
    shape: Shape,
    /** [width, height] default size. */
    size: z.tuple([z.number().positive(), z.number().positive()]),
    label: z.enum(["center", "below", "top"]),
    props: z.record(PropType),
    ports: z.array(Side),
    container: z.boolean(),
    /** Kinds allowed as direct children (containers only). Omitted = any. */
    allows: z.array(z.string()),
    layout: z.object({ layer: z.enum(["first", "last"]) }).partial(),
    style: NodeStyle,
  })
  .partial();
export type NodeKindDef = z.infer<typeof NodeKindDef>;

/** "a -> b" where a/b are node kinds or "*". */
export const KindPair = z.string().regex(/^\s*[\w.*]+\s*->\s*[\w.*]+\s*$/, 'expected "kindA -> kindB"');

export const EdgeKindDef = z
  .object({
    description: z.string(),
    style: z.enum(["solid", "dashed", "dotted"]),
    arrow: z.enum(["none", "end", "start", "both"]),
    color: z.string(),
    /** If set, only these kind pairs may use this edge kind. */
    allowed: z.array(KindPair),
  })
  .partial();
export type EdgeKindDef = z.infer<typeof EdgeKindDef>;

export const RuleDef = z.object({
  forbid: KindPair,
  message: z.string(),
  severity: z.enum(["error", "warning"]).default("error"),
});
export type RuleDef = z.infer<typeof RuleDef>;

export const Theme = z
  .object({
    background: z.string(),
    fontFamily: z.string(),
    fontSize: z.number(),
    nodeFill: z.string(),
    nodeStroke: z.string(),
    textColor: z.string(),
    edgeColor: z.string(),
    containerFill: z.string(),
    containerStroke: z.string(),
  })
  .partial();
export type Theme = z.infer<typeof Theme>;

export const LayoutDefaults = z
  .object({
    direction: z.enum(["RIGHT", "DOWN", "LEFT", "UP"]),
    nodeSpacing: z.number(),
    layerSpacing: z.number(),
  })
  .partial();
export type LayoutDefaults = z.infer<typeof LayoutDefaults>;

export const ProfileDef = z.object({
  name: z.string().regex(/^[\w-]+(\/[\w-]+)*$/),
  version: z.string().default("0.0.0"),
  description: z.string().optional(),
  extends: z.union([z.string(), z.array(z.string())]).optional(),
  nodes: z.record(NodeKindDef).default({}),
  edges: z.record(EdgeKindDef).default({}),
  /** Edge kind used when an edge has no `: kind`. */
  defaultEdge: z.string().optional(),
  rules: z.array(RuleDef).default([]),
  theme: Theme.default({}),
  layout: LayoutDefaults.default({}),
});
export type ProfileDef = z.infer<typeof ProfileDef>;

// ---- Resolved form (after extends-merging, namespacing and asset loading) ----

export interface ResolvedNodeKind extends NodeKindDef {
  /** Fully qualified kind as used in the diagram ("service", "k8s.pod"). */
  kind: string;
  /** Sanitized inline SVG markup, if the kind has an icon. */
  iconSvg?: string;
}

export interface ResolvedEdgeKind extends EdgeKindDef {
  kind: string;
}

export interface ResolvedProfile {
  /** Profiles that were loaded, by name, for diagnostics. */
  sources: { name: string; version: string; alias?: string }[];
  nodes: Record<string, ResolvedNodeKind>;
  edges: Record<string, ResolvedEdgeKind>;
  defaultEdge?: string;
  rules: (RuleDef & { forbid: string })[];
  theme: Theme;
  layout: LayoutDefaults;
}

export const DEFAULT_NODE_SIZE: [number, number] = [140, 60];

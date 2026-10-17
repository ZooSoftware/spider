// Shared contract: the semantic model. No coordinates, no DOM, no diagram-type knowledge.

/** Half-open range of UTF-16 offsets into the source text. */
export interface Span {
  start: number;
  end: number;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  /** Stable machine-readable code, e.g. "parse/unexpected-token", "model/duplicate-id". */
  code: string;
  message: string;
  span?: Span;
}

export type PropValue = string | number | boolean;

/** `use <profile>[@version] [as alias]` */
export interface UseDecl {
  profile: string;
  version?: string;
  alias?: string;
  span: Span;
}

export interface ModelNode {
  /** Explicit, globally unique. Matches /^[A-Za-z_][A-Za-z0-9_]*$/. */
  id: string;
  /** Kind as written, possibly namespaced: "service", "k8s.pod". Resolved by a profile later. */
  kind: string;
  label?: string;
  props: Record<string, PropValue>;
  /** Id of the enclosing container node, if any. */
  parent?: string;
  /** Ids of direct child nodes, in source order. Non-empty only for containers. */
  children: string[];
  /** True when written with a block containing child statements. */
  isContainer: boolean;
  span: Span;
}

export interface ModelEdge {
  /** "a->b" for the first edge between a and b, then "a->b#2", "a->b#3" in source order. */
  id: string;
  source: string;
  target: string;
  /** Edge kind after `:`, e.g. "calls". */
  kind?: string;
  label?: string;
  span: Span;
}

export interface Model {
  uses: UseDecl[];
  /** Insertion order = source order. */
  nodes: Map<string, ModelNode>;
  edges: Map<string, ModelEdge>;
  /** Ids of top-level nodes, in source order. */
  roots: string[];
}

export function edgeId(source: string, target: string, ordinal: number): string {
  return ordinal <= 1 ? `${source}->${target}` : `${source}->${target}#${ordinal}`;
}

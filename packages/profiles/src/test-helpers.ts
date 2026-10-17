// Test-only helpers: build Model objects by hand (the parser is developed separately).
import type { Model, ModelEdge, ModelNode, PropValue, UseDecl } from "@spider/core";

const edgeId = (s: string, t: string, n: number) => (n <= 1 ? `${s}->${t}` : `${s}->${t}#${n}`);

export function use(profile: string, extra: { version?: string; alias?: string } = {}, at = 0): UseDecl {
  return { profile, ...extra, span: { start: at, end: at + 10 } };
}

export interface NodeSpec {
  id: string;
  kind: string;
  parent?: string;
  props?: Record<string, PropValue>;
}

/** Nodes get spans by position; edges are [source, target, kind?]. */
export function makeModel(nodes: NodeSpec[], edges: [string, string, string?][] = [], uses: UseDecl[] = []): Model {
  const m: Model = { uses, nodes: new Map(), edges: new Map(), roots: [] };
  nodes.forEach((n, i) => {
    const node: ModelNode = {
      id: n.id,
      kind: n.kind,
      props: n.props ?? {},
      children: [],
      isContainer: false,
      span: { start: 100 + i * 10, end: 109 + i * 10 },
      ...(n.parent ? { parent: n.parent } : {}),
    };
    m.nodes.set(n.id, node);
  });
  for (const n of m.nodes.values()) {
    const p = n.parent ? m.nodes.get(n.parent) : undefined;
    if (p) {
      p.children.push(n.id);
      p.isContainer = true;
    } else m.roots.push(n.id);
  }
  const count = new Map<string, number>();
  edges.forEach(([source, target, kind], i) => {
    const key = `${source}->${target}`;
    const ord = (count.get(key) ?? 0) + 1;
    count.set(key, ord);
    const e: ModelEdge = { id: edgeId(source, target, ord), source, target, span: { start: 1000 + i * 10, end: 1009 + i * 10 }, ...(kind ? { kind } : {}) };
    m.edges.set(e.id, e);
  });
  return m;
}

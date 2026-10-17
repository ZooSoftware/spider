// Router tests: obstacle avoidance, orthogonality, boundary endpoints, parallel separation,
// ports, manual edges, self-loops, determinism, performance.
import { describe, expect, test } from "bun:test";
import type { Model } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import { ancestors, occupiedRect, rectsOverlap, type Rect } from "./geometry.ts";
import type { EdgeLayout, LayoutFile, NodeLayout, Point } from "./layout-file.ts";
import { layoutDiagram } from "./layout.ts";
import { routeEdges } from "./router.ts";
import { buildModel, buildProfile, segmentCrossesRect, type EdgeSpec } from "./test-utils.ts";

const profile = buildProfile({ db: { size: [110, 70], label: "below" }, queue: { ports: ["left", "right"] } });

function onBoundary(p: Point, r: Rect): boolean {
  const inX = p[0] >= r.x && p[0] <= r.x + r.w, inY = p[1] >= r.y && p[1] <= r.y + r.h;
  return (inY && (p[0] === r.x || p[0] === r.x + r.w)) || (inX && (p[1] === r.y || p[1] === r.y + r.h));
}

/** All geometric violations of the routing contract. */
export function routeViolations(model: Model, prof: ResolvedProfile, layout: LayoutFile): string[] {
  const bad: string[] = [];
  const box = (id: string): Rect => occupiedRect(prof, model.nodes.get(id)!, layout.nodes[id]!);
  for (const e of model.edges.values()) {
    const l = layout.edges[e.id];
    if (!l) { bad.push(`${e.id}: missing`); continue; }
    const P = l.points;
    for (let i = 0; i + 1 < P.length; i++) {
      if (P[i]![0] !== P[i + 1]![0] && P[i]![1] !== P[i + 1]![1]) bad.push(`${e.id}: diagonal segment ${i}`);
    }
    if (!onBoundary(P[0]!, box(e.source))) bad.push(`${e.id}: start ${P[0]} not on ${e.source}`);
    if (!onBoundary(P[P.length - 1]!, box(e.target))) bad.push(`${e.id}: end ${P[P.length - 1]} not on ${e.target}`);
    if (e.source === e.target) continue;
    const skip = new Set([e.source, e.target, ...ancestors(model, e.source), ...ancestors(model, e.target)]);
    for (const n of model.nodes.values()) {
      if (skip.has(n.id) || !layout.nodes[n.id]) continue;
      const r = box(n.id);
      if (rectsOverlap(r, box(e.source)) || rectsOverlap(r, box(e.target))) continue;
      for (let i = 0; i + 1 < P.length; i++) {
        if (segmentCrossesRect(P[i]!, P[i + 1]!, r)) bad.push(`${e.id}: segment ${i} crosses ${n.id}`);
      }
    }
  }
  return bad;
}

/** Pairs of edges with overlapping collinear segments. */
function overlaps(a: EdgeLayout, b: EdgeLayout): boolean {
  for (let i = 0; i + 1 < a.points.length; i++) {
    for (let k = 0; k + 1 < b.points.length; k++) {
      const [p, q] = [a.points[i]!, a.points[i + 1]!], [r, s] = [b.points[k]!, b.points[k + 1]!];
      for (const ax of [0, 1] as const) {
        const al = 1 - ax;
        if (p[ax] === q[ax] && r[ax] === s[ax] && p[ax] === r[ax]) {
          const lo = Math.max(Math.min(p[al]!, q[al]!), Math.min(r[al]!, s[al]!));
          const hi = Math.min(Math.max(p[al]!, q[al]!), Math.max(r[al]!, s[al]!));
          if (hi - lo > 0) return true;
        }
      }
    }
  }
  return false;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bigModel(n: number, m: number): Model {
  const r = rng(42);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: i % 7 === 0 ? "db" : "service" }));
  const edges: EdgeSpec[] = [];
  for (let i = 1; i < n; i++) edges.push([`n${Math.floor(r() * i)}`, `n${i}`]);
  while (edges.length < m) {
    const a = Math.floor(r() * n), b = Math.floor(r() * n);
    if (a !== b) edges.push([`n${Math.min(a, b)}`, `n${Math.max(a, b)}`]);
  }
  return buildModel(nodes, edges);
}

const grid = (cols: number, rows: number, w = 140, h = 60, gx = 80, gy = 60): Record<string, NodeLayout> => {
  const out: Record<string, NodeLayout> = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[`g${r}_${c}`] = { x: c * (w + gx), y: r * (h + gy), w, h };
  return out;
};

describe("routeEdges", () => {
  test("routes around obstacles in a dense grid, orthogonal, endpoints on boundaries", () => {
    const nodes = grid(5, 4);
    const ids = Object.keys(nodes);
    const edges: EdgeSpec[] = [
      ["g0_0", "g3_4"], ["g0_4", "g3_0"], ["g1_0", "g1_4"], ["g0_2", "g3_2"], ["g2_1", "g0_3"],
      ["g3_3", "g0_1"], ["g1_1", "g2_3"], ["g0_0", "g0_4"], ["g2_0", "g2_4"], ["g1_2", "g1_2"],
    ];
    const model = buildModel(ids, edges);
    const layout: LayoutFile = { version: 1, nodes, edges: routeEdges(model, profile, nodes) };
    expect(routeViolations(model, profile, layout)).toEqual([]);
  });

  test("full example layout has no violations", async () => {
    const model = buildModel(
      ["a", { id: "z", kind: "zone", container: true }, { id: "b", parent: "z" }, { id: "c", parent: "z", kind: "db" }, "d", { id: "q", kind: "queue" }],
      [["a", "b"], ["b", "c"], ["a", "d"], ["d", "c"], ["c", "a"], ["b", "q"], ["q", "d"], ["a", "z"]],
    );
    const layout = await layoutDiagram(model, profile);
    expect(routeViolations(model, profile, layout)).toEqual([]);
  });

  test("parallel edges between the same pair are separated", () => {
    const nodes = { a: { x: 0, y: 0, w: 140, h: 60 }, b: { x: 300, y: 100, w: 140, h: 60 }, c: { x: 0, y: 300, w: 140, h: 60 } };
    const model = buildModel(["a", "b", "c"], [["a", "b"], ["a", "b"], ["b", "a"], ["a", "c"], ["a", "c"]]);
    const edges = routeEdges(model, profile, nodes);
    const list = Object.values(edges);
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length; k++) expect(overlaps(list[i]!, list[k]!)).toBe(false);
    }
    const starts = new Set(list.map((e) => e.points[0]!.join(",")));
    expect(starts.size).toBe(list.length);
  });

  test("facing nodes get a straight edge", () => {
    const nodes = { a: { x: 0, y: 0, w: 140, h: 60 }, b: { x: 300, y: 20, w: 140, h: 60 } };
    const edges = routeEdges(buildModel(["a", "b"], [["a", "b"]]), profile, nodes);
    expect(edges["a->b"]!.points).toEqual([[140, 40], [300, 40]]);
  });

  test("honors kind ports and stored ports", () => {
    const nodes = { a: { x: 0, y: 0, w: 140, h: 60 }, q: { x: 0, y: 200, w: 140, h: 60 } };
    const model = buildModel(["a", { id: "q", kind: "queue" }], [["a", "q"]]);
    const e = routeEdges(model, profile, nodes)["a->q"]!;
    const end = e.points[e.points.length - 1]!;
    expect(end[0] === 0 || end[0] === 140).toBe(true); // queue: left/right only
    const stored = routeEdges(model, profile, nodes, { "a->q": { points: [], sourcePort: "left", targetPort: "right" } })["a->q"]!;
    expect(stored.points[0]![0]).toBe(0);
    expect(stored.points[stored.points.length - 1]![0]).toBe(140);
    expect(stored.sourcePort).toBe("left");
  });

  test("manual edges keep waypoints; endpoints re-snap when a node moves", () => {
    const nodes = { a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 300, y: 0, w: 100, h: 50 } };
    const model = buildModel(["a", "b"], [["a", "b"]]);
    const manual: EdgeLayout = { points: [[100, 25], [200, 25], [200, 100], [300, 100]], manual: true };
    // b's left side does not contain y=100 -> re-snap.
    const out = routeEdges(model, profile, nodes, { "a->b": manual })["a->b"]!;
    expect(out.manual).toBe(true);
    expect(out.points.slice(0, 3)).toEqual([[100, 25], [200, 25], [200, 100]]);
    const last = out.points[out.points.length - 1]!;
    expect(onBoundary(last, nodes.b)).toBe(true);
    for (let i = 0; i + 1 < out.points.length; i++) {
      const p = out.points[i]!, q = out.points[i + 1]!;
      expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
    }
    // Unmoved: identical.
    const still = { ...manual, points: [[100, 25], [200, 25], [200, 30], [300, 30]] as Point[] };
    expect(routeEdges(model, profile, nodes, { "a->b": still })["a->b"]!.points).toEqual(still.points);
  });

  test("self-loop is a small orthogonal loop starting and ending on the node", () => {
    const nodes = { a: { x: 100, y: 100, w: 140, h: 60 } };
    const model = buildModel(["a"], [["a", "a", "retry"]]);
    const e = routeEdges(model, profile, nodes)["a->a"]!;
    expect(onBoundary(e.points[0]!, nodes.a)).toBe(true);
    expect(onBoundary(e.points[e.points.length - 1]!, nodes.a)).toBe(true);
    expect(e.labelPos).toBeDefined();
  });

  test("label position is the middle of the longest segment", () => {
    const nodes = { a: { x: 0, y: 0, w: 140, h: 60 }, b: { x: 400, y: 0, w: 140, h: 60 } };
    const e = routeEdges(buildModel(["a", "b"], [["a", "b", "x"]]), profile, nodes)["a->b"]!;
    expect(e.labelPos).toEqual([270, 30]);
  });

  test("deterministic", () => {
    const model = bigModel(40, 60);
    const nodes = grid(8, 5);
    const ids = Object.keys(nodes);
    const mapped: Record<string, NodeLayout> = {};
    ids.forEach((g, i) => (mapped[`n${i}`] = nodes[g]!));
    const a = routeEdges(model, profile, mapped);
    const b = routeEdges(model, profile, structuredClone(mapped));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("performance: ~100 nodes / 150 edges", async () => {
    const model = bigModel(100, 150);
    const layout = await layoutDiagram(model, profile);
    routeEdges(model, profile, layout.nodes); // warm-up
    const runs = 10;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) routeEdges(model, profile, layout.nodes);
    const ms = (performance.now() - t0) / runs;
    console.log(`routeEdges 100 nodes / 150 edges: ${ms.toFixed(2)} ms (avg of ${runs})`);
    expect(ms).toBeLessThan(100);
    expect(routeViolations(model, profile, layout)).toEqual([]);
  });
});

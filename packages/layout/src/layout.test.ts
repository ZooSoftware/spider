// layoutDiagram tests: full layout sanity, containers, incremental stability, pinning, orphans.
import { describe, expect, test } from "bun:test";
import { ancestors, CONTAINER_PADDING, occupiedRect, rectsOverlap } from "./geometry.ts";
import type { LayoutFile } from "./layout-file.ts";
import { layoutDiagram } from "./layout.ts";
import { buildModel, buildProfile, type EdgeSpec, type NodeSpec } from "./test-utils.ts";
import type { Model } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";

const profile = buildProfile({
  user: { size: [60, 60], label: "below", layout: { layer: "first" } },
  db: { size: [110, 70], label: "below" },
  external: { layout: { layer: "last" } },
});

const NODES: NodeSpec[] = [
  { id: "user", kind: "user" },
  { id: "api" },
  { id: "vpc", kind: "zone", container: true },
  { id: "order", parent: "vpc" },
  { id: "pay", parent: "vpc" },
  { id: "db", kind: "db", parent: "vpc" },
  { id: "stripe", kind: "external" },
  { id: "mail", kind: "external" },
];
const EDGES: EdgeSpec[] = [
  ["user", "api"], ["api", "order"], ["api", "pay"], ["order", "db"], ["order", "pay"], ["pay", "stripe"], ["order", "mail"],
];

/** Non-nested node pairs must not overlap (incl. label space). */
function overlapping(model: Model, prof: ResolvedProfile, l: LayoutFile): string[] {
  const ids = Object.keys(l.nodes);
  const bad: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let k = i + 1; k < ids.length; k++) {
      const a = ids[i]!, b = ids[k]!;
      if (ancestors(model, a).includes(b) || ancestors(model, b).includes(a)) continue;
      const ra = occupiedRect(prof, model.nodes.get(a)!, l.nodes[a]!), rb = occupiedRect(prof, model.nodes.get(b)!, l.nodes[b]!);
      if (rectsOverlap(ra, rb)) bad.push(`${a}/${b}`);
    }
  }
  return bad;
}

function encloses(model: Model, prof: ResolvedProfile, l: LayoutFile): boolean {
  for (const n of model.nodes.values()) {
    if (!n.parent) continue;
    const p = l.nodes[n.parent]!, c = occupiedRect(prof, n, l.nodes[n.id]!);
    if (c.x < p.x || c.y < p.y || c.x + c.w > p.x + p.w || c.y + c.h > p.y + p.h) return false;
  }
  return true;
}

const allInts = (l: LayoutFile): boolean =>
  Object.values(l.nodes).every((n) => [n.x, n.y, n.w, n.h].every(Number.isInteger)) &&
  Object.values(l.edges).every((e) => e.points.flat().every(Number.isInteger));

describe("layoutDiagram: full", () => {
  test("no overlaps, containers enclose children, integer coords, every element laid out", async () => {
    const model = buildModel(NODES, EDGES);
    const l = await layoutDiagram(model, profile);
    expect(Object.keys(l.nodes)).toEqual([...model.nodes.keys()]);
    expect(Object.keys(l.edges)).toEqual([...model.edges.keys()]);
    expect(overlapping(model, profile, l)).toEqual([]);
    expect(encloses(model, profile, l)).toBe(true);
    expect(allInts(l)).toBe(true);
    expect(l.nodes.order!.x - l.nodes.vpc!.x).toBeGreaterThanOrEqual(CONTAINER_PADDING);
  });

  test("sizes from profile; layer first/last respected for direction RIGHT", async () => {
    const model = buildModel(NODES, EDGES);
    const l = await layoutDiagram(model, profile);
    expect([l.nodes.user!.w, l.nodes.user!.h]).toEqual([60, 60]);
    expect([l.nodes.api!.w, l.nodes.api!.h]).toEqual([140, 60]);
    const maxRight = Math.max(...Object.entries(l.nodes).filter(([id]) => id !== "user").map(([, n]) => n.x));
    expect(l.nodes.user!.x).toBeLessThan(Math.min(...Object.entries(l.nodes).filter(([id]) => id !== "user").map(([, n]) => n.x)));
    expect(l.nodes.stripe!.x).toBeGreaterThanOrEqual(maxRight - 1);
  });

  test("direction DOWN stacks layers vertically", async () => {
    const model = buildModel(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
    const l = await layoutDiagram(model, buildProfile({}, { direction: "DOWN" }));
    expect(l.nodes.a!.y).toBeLessThan(l.nodes.b!.y);
    expect(l.nodes.b!.y).toBeLessThan(l.nodes.c!.y);
  });

  test("deterministic", async () => {
    const model = buildModel(NODES, EDGES);
    const a = await layoutDiagram(model, profile);
    const b = await layoutDiagram(buildModel(NODES, EDGES), profile);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("layoutDiagram: incremental", () => {
  test("adding nodes keeps every existing node exactly in place; new nodes do not overlap", async () => {
    const m1 = buildModel(NODES, EDGES);
    const l1 = await layoutDiagram(m1, profile);
    l1.nodes.api = { ...l1.nodes.api!, x: l1.nodes.api!.x + 37, y: l1.nodes.api!.y - 23, pinned: true }; // user drag
    const m2 = buildModel(
      [...NODES, { id: "fraud", parent: "vpc" }, { id: "audit" }, { id: "lonely" }],
      [...EDGES, ["pay", "fraud"], ["fraud", "audit"], ["api", "audit"]],
    );
    const l2 = await layoutDiagram(m2, profile, l1);
    for (const n of m1.nodes.values()) {
      if (n.children.length > 0) continue;
      expect(l2.nodes[n.id]).toEqual(l1.nodes[n.id]!);
    }
    expect(l2.nodes.api!.pinned).toBe(true);
    for (const id of ["fraud", "audit", "lonely"]) expect(l2.nodes[id]).toBeDefined();
    expect(overlapping(m2, profile, l2)).toEqual([]);
    expect(encloses(m2, profile, l2)).toBe(true);
    expect(allInts(l2)).toBe(true);
  });

  test("a new container with children is placed as one block", async () => {
    const m1 = buildModel(NODES, EDGES);
    const l1 = await layoutDiagram(m1, profile);
    const m2 = buildModel(
      [...NODES, { id: "ops", kind: "zone", container: true }, { id: "mon", parent: "ops" }, { id: "logs", parent: "ops" }],
      [...EDGES, ["api", "mon"], ["mon", "logs"]],
    );
    const l2 = await layoutDiagram(m2, profile, l1);
    for (const id of ["user", "api", "order", "pay", "db", "stripe", "mail"]) expect(l2.nodes[id]).toEqual(l1.nodes[id]!);
    expect(overlapping(m2, profile, l2)).toEqual([]);
    expect(encloses(m2, profile, l2)).toBe(true);
  });

  test("no model change: positions identical, routes recomputed", async () => {
    const model = buildModel(NODES, EDGES);
    const l1 = await layoutDiagram(model, profile);
    const l2 = await layoutDiagram(model, profile, l1);
    expect(l2).toEqual(l1);
  });

  test("pinned container keeps x/y but grows to fit", async () => {
    const model = buildModel(NODES, EDGES);
    const l1 = await layoutDiagram(model, profile);
    const vpc = l1.nodes.vpc!;
    l1.nodes.vpc = { ...vpc, pinned: true };
    l1.nodes.db = { ...l1.nodes.db!, x: vpc.x + vpc.w + 100 }; // child dragged out to the right
    const l2 = await layoutDiagram(model, profile, l1);
    expect([l2.nodes.vpc!.x, l2.nodes.vpc!.y]).toEqual([vpc.x, vpc.y]);
    expect(l2.nodes.vpc!.w).toBeGreaterThan(vpc.w);
    expect(encloses(model, profile, l2)).toBe(true);
  });

  test("orphans are removed; manual edges survive", async () => {
    const model = buildModel(NODES, EDGES);
    const l1 = await layoutDiagram(model, profile);
    l1.nodes.ghost = { x: 0, y: 0, w: 10, h: 10 };
    l1.edges["ghost->api"] = { points: [[0, 0], [1, 0]] };
    const pts = l1.edges["api->order"]!.points;
    l1.edges["api->order"] = { points: pts, manual: true };
    const l2 = await layoutDiagram(model, profile, l1);
    expect(l2.nodes.ghost).toBeUndefined();
    expect(l2.edges["ghost->api"]).toBeUndefined();
    expect(l2.edges["api->order"]).toEqual({ points: pts, manual: true });
  });

  test("reset ignores previous positions", async () => {
    const model = buildModel(NODES, EDGES);
    const fresh = await layoutDiagram(model, profile);
    const moved: LayoutFile = structuredClone(fresh);
    moved.nodes.api = { ...moved.nodes.api!, x: 5000, pinned: true };
    expect(await layoutDiagram(model, profile, moved, { reset: true })).toEqual(fresh);
  });
});

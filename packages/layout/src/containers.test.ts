// B8: containers always fit their real children; user min size; overlaps are reported, not fixed.
import { describe, expect, test } from "bun:test";
import { containerOverlaps, CONTAINER_PADDING, CONTAINER_TITLE_SPACE, fitContainers } from "./geometry.ts";
import { layoutDiagram } from "./layout.ts";
import { parseLayoutFile, serializeLayoutFile } from "./layout-io.ts";
import { buildModel, buildProfile } from "./test-utils.ts";

const profile = buildProfile({});
const model = buildModel(
  [{ id: "vpc", kind: "zone", container: true }, { id: "a", parent: "vpc" }, { id: "b", parent: "vpc" }, { id: "x" }],
  [["a", "b"]],
);
const box = (x: number, y: number) => ({ x, y, w: 140, h: 60 });

describe("fitContainers", () => {
  test("fits exactly around children", () => {
    const nodes = fitContainers(model, profile, { a: box(100, 100), b: box(300, 100), vpc: { x: 0, y: 0, w: 10, h: 10 } });
    expect(nodes.vpc).toEqual({
      x: 100 - CONTAINER_PADDING,
      y: 100 - CONTAINER_TITLE_SPACE,
      w: 340 + 2 * CONTAINER_PADDING,
      h: 60 + CONTAINER_TITLE_SPACE + CONTAINER_PADDING,
    });
  });

  test("a pinned container shrinks back when children move closer", () => {
    const nodes = { a: box(100, 100), b: box(900, 100), vpc: { x: 0, y: 0, w: 10, h: 10, pinned: true } };
    fitContainers(model, profile, nodes);
    const wide = nodes.vpc.w;
    nodes.b = box(300, 100);
    fitContainers(model, profile, nodes);
    expect(nodes.vpc.w).toBeLessThan(wide);
    expect(nodes.vpc.w).toBe(340 + 2 * CONTAINER_PADDING);
    expect(nodes.vpc.pinned).toBe(true);
  });

  test("min size adds room but never shrinks below content", () => {
    const nodes = { a: box(100, 100), b: box(300, 100), vpc: { x: 0, y: 0, w: 10, h: 10, minW: 800, minH: 50 } };
    fitContainers(model, profile, nodes);
    expect(nodes.vpc.w).toBe(800);
    expect(nodes.vpc.h).toBe(60 + CONTAINER_TITLE_SPACE + CONTAINER_PADDING); // min 50 < content
    expect(nodes.vpc.x).toBe(100 - CONTAINER_PADDING);
    expect([nodes.vpc.minW, nodes.vpc.minH]).toEqual([800, 50]);
  });
});

describe("containerOverlaps", () => {
  test("reports a non-member under a container, never members or ancestors", () => {
    const nodes = fitContainers(model, profile, { a: box(100, 100), b: box(300, 100), x: box(200, 100), vpc: { x: 0, y: 0, w: 1, h: 1 } });
    expect(containerOverlaps(model, profile, nodes)).toEqual([{ node: "x", container: "vpc" }]);
    nodes.x = box(1000, 100);
    expect(containerOverlaps(model, profile, nodes)).toEqual([]);
  });

  test("layoutDiagram never moves a node to resolve an overlap", async () => {
    const l1 = await layoutDiagram(model, profile);
    const vpc = l1.nodes.vpc!;
    l1.nodes.x = { ...l1.nodes.x!, x: vpc.x + 30, y: vpc.y + 40, pinned: true };
    const l2 = await layoutDiagram(model, profile, l1);
    expect(l2.nodes.x).toEqual(l1.nodes.x);
    expect(containerOverlaps(model, profile, l2.nodes).map((o) => o.node)).toContain("x");
  });
});

test("minW/minH survive the layout file round trip", () => {
  const json = serializeLayoutFile({ version: 1, nodes: { vpc: { x: 0, y: 0, w: 900, h: 300, minW: 900, minH: 300 } }, edges: {} });
  expect(json).toContain('"minW":900');
  expect(parseLayoutFile(json).layout.nodes.vpc).toEqual({ x: 0, y: 0, w: 900, h: 300, minW: 900, minH: 300 });
});

import { describe, expect, test } from "bun:test";
import { dedupe, edgeLabelPos, isOrthogonal, moveSegment, sideOf } from "../src/edge-edit.ts";
import type { Point } from "../src/layout-file.ts";
import { routeEdges } from "../src/router/index.ts";
import { buildModel, buildProfile } from "./test-utils.ts";

const src = { x: 0, y: 0, w: 100, h: 60 };
const tgt = { x: 300, y: 200, w: 100, h: 60 };
// Z route: right side of src -> left side of tgt.
const Z: Point[] = [[100, 30], [200, 30], [200, 230], [300, 230]];

describe("moveSegment", () => {
  test("interior segment moves sideways, neighbours stretch, stays orthogonal", () => {
    const out = moveSegment(Z, 1, 250, src, tgt);
    expect(out).toEqual([[100, 30], [250, 30], [250, 230], [300, 230]]);
    expect(isOrthogonal(out)).toBe(true);
  });

  test("end segment slides the line end along the node side, clamped to the side", () => {
    expect(moveSegment(Z, 0, 40, src, tgt)).toEqual([[100, 40], [200, 40], [200, 230], [300, 230]]);
    expect(moveSegment(Z, 0, 500, src, tgt)[0]).toEqual([100, 54]); // 60 - corner gap
    expect(moveSegment(Z, 2, 210, src, tgt).slice(-1)[0]).toEqual([300, 210]);
  });

  test("a straight line slides both ends within both sides", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 }, b = { x: 300, y: 20, w: 100, h: 60 };
    expect(moveSegment([[100, 40], [300, 40]], 0, 50, a, b)).toEqual([[100, 50], [300, 50]]);
    expect(moveSegment([[100, 40], [300, 40]], 0, 0, a, b)).toEqual([[100, 26], [300, 26]]); // clamped by b
  });

  test("moving a segment onto its neighbour merges points", () => {
    const out = moveSegment([[100, 30], [200, 30], [200, 100], [250, 100], [250, 230], [300, 230]], 2, 30, src, tgt);
    expect(isOrthogonal(out)).toBe(true);
    expect(out.length).toBeLessThan(6);
  });
});

test("sideOf picks the closest side", () => {
  expect(sideOf(src, [100, 30])).toBe("right");
  expect(sideOf(src, [50, -5])).toBe("top");
  expect(sideOf(src, [-3, 40])).toBe("left");
  expect(sideOf(src, [50, 70])).toBe("bottom");
});

test("dedupe and label position", () => {
  expect(dedupe([[0, 0], [0, 0], [10, 0], [20, 0], [20, 5]])).toEqual([[0, 0], [20, 0], [20, 5]]);
  expect(edgeLabelPos(Z)).toEqual([200, 130]);
});

test("a manual route stays orthogonal when a connected node moves", () => {
  const model = buildModel([{ id: "a" }, { id: "b" }], [["a", "b"]]);
  const profile = buildProfile({});
  const nodes = { a: { x: 0, y: 0, w: 100, h: 60 }, b: { x: 300, y: 200, w: 100, h: 60 } };
  const manual = { points: moveSegment(Z, 1, 250, nodes.a, nodes.b), manual: true };
  const moved = { ...nodes, b: { x: 320, y: 120, w: 100, h: 60 } };
  const out = routeEdges(model, profile, moved, { "a->b": manual })["a->b"]!;
  expect(out.manual).toBe(true);
  expect(isOrthogonal(out.points)).toBe(true);
  expect(out.points[1]).toEqual([250, 30]); // the user's segment is kept
  const end = out.points[out.points.length - 1]!;
  expect(end[0]).toBe(320); // re-snapped onto b's left side
});

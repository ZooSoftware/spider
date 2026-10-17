// Layout IO tests: reconcile, tolerant parse, stable serialization.
import { describe, expect, test } from "bun:test";
import type { LayoutFile } from "../src/layout-file.ts";
import { parseLayoutFile, reconcileLayout, serializeLayoutFile } from "../src/layout-io.ts";
import { buildModel } from "./test-utils.ts";

const model = buildModel(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
const layout: LayoutFile = {
  version: 1,
  nodes: { c: { x: 1, y: 2, w: 3, h: 4 }, a: { x: 0, y: 0, w: 10, h: 10, pinned: true }, gone: { x: 0, y: 0, w: 1, h: 1 } },
  edges: { "b->c": { points: [[0, 0], [5, 0]], manual: true, sourcePort: "right" }, "x->y": { points: [] } },
};

describe("layout io", () => {
  test("reconcile drops orphans and follows model order", () => {
    const r = reconcileLayout(model, layout);
    expect(Object.keys(r.nodes)).toEqual(["a", "c"]);
    expect(Object.keys(r.edges)).toEqual(["b->c"]);
  });

  test("serialize -> parse round trip, one entry per line, model order", () => {
    const text = serializeLayoutFile(reconcileLayout(model, layout), model);
    expect(text).toBe(
      `{
  "version": 1,
  "nodes": {
    "a": {"x":0,"y":0,"w":10,"h":10,"pinned":true},
    "c": {"x":1,"y":2,"w":3,"h":4}
  },
  "edges": {
    "b->c": {"points":[[0,0],[5,0]],"manual":true,"sourcePort":"right"}
  }
}
`,
    );
    const { layout: back, diagnostics } = parseLayoutFile(text);
    expect(diagnostics).toEqual([]);
    expect(back).toEqual(reconcileLayout(model, layout));
    expect(serializeLayoutFile(back, model)).toBe(text);
  });

  test("parse reports invalid json and skips invalid entries", () => {
    expect(parseLayoutFile("{nope").diagnostics[0]!.code).toBe("layout/invalid-json");
    const { layout: l, diagnostics } = parseLayoutFile(
      JSON.stringify({ version: 1, nodes: { a: { x: 1, y: 1, w: 1, h: 1 }, b: { x: "1" } }, edges: { e: { points: [[1]] } } }),
    );
    expect(Object.keys(l.nodes)).toEqual(["a"]);
    expect(l.edges).toEqual({});
    expect(diagnostics.map((d) => d.code)).toEqual(["layout/invalid-node", "layout/invalid-edge"]);
  });
});

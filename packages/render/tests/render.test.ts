import { describe, expect, test } from "bun:test";
import { compile } from "@spider/engine/node";
import { renderSvg, roundedPath } from "../src/index.ts";
import { contentScale } from "../src/render.ts";
import { snapToOutline } from "../src/shapes.ts";
import { wrap } from "../src/svg.ts";

const SRC = `use base/architecture
zone vpc "VPC <prod>" {
  service api "API & Co" { tech: "Go" }
  db store "Store"
}
widget w "Mystery"
api -> store : data "SQL"
api -> w
`;

test("renders every node and edge with data-id hooks", async () => {
  const { svg, model } = await compile(SRC);
  for (const id of model.nodes.keys()) expect(svg).toContain(`data-id="${id}"`);
  for (const id of model.edges.keys()) expect(svg).toContain(`class="spd-edge" data-id="${id.replace(">", "&gt;")}"`);
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
});

test("escapes labels", async () => {
  const { svg } = await compile(SRC);
  expect(svg).toContain("VPC &lt;prod&gt;");
  expect(svg).toContain("API &amp; Co");
  expect(svg).not.toContain("<prod>");
});

test("unknown kinds render as a dashed warning box with the kind name", async () => {
  const { svg } = await compile(SRC);
  const w = svg.slice(svg.indexOf('data-id="w"'));
  expect(w).toContain('stroke-dasharray="6 4"');
  expect(w).toContain("widget (unknown)");
});

test("edge kinds map to dash styles and arrow markers", async () => {
  const { svg } = await compile(SRC);
  expect(svg).toContain('stroke-dasharray="1.5 3.5"'); // data = dotted
  expect(svg).toMatch(/<marker id="spd-arrow-e-/);
  expect(svg).toContain(">SQL</text>");
});

test("viewBox covers nodes at negative coordinates", async () => {
  const { model, profile, layout } = await compile(SRC);
  layout.nodes.w = { x: -500, y: -300, w: 140, h: 60 };
  const svg = renderSvg(model, profile, layout);
  const [x, y] = /viewBox="(-?[\d.]+) (-?[\d.]+)/.exec(svg)!.slice(1).map(Number);
  expect(x!).toBeLessThanOrEqual(-500);
  expect(y!).toBeLessThanOrEqual(-300);
});

test("output is deterministic", async () => {
  expect((await compile(SRC)).svg).toBe((await compile(SRC)).svg);
});

test("roundedPath keeps endpoints and rounds corners", () => {
  const d = roundedPath([[0, 0], [100, 0], [100, 50]], 6);
  expect(d.startsWith("M0 0")).toBe(true);
  expect(d.endsWith("L100 50")).toBe(true);
  expect(d).toContain("Q100 0");
});

test("snapToOutline moves endpoints onto diamond and ellipse outlines", () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };
  expect(snapToOutline("diamond", box, [0, 25])).toEqual([0, 25]);
  expect(snapToOutline("diamond", box, [50, 0])).toEqual([50, 0]);
  expect(snapToOutline("diamond", box, [25, 0])).toEqual([25, 12.5]);
  const [ex] = snapToOutline("circle", box, [0, 5]);
  expect(ex).toBeGreaterThan(0);
  expect(snapToOutline("rect", box, [0, 5])).toEqual([0, 5]);
});

test("wrap breaks long labels and ellipsizes overflow", () => {
  expect(wrap("short", 13, 200)).toEqual(["short"]);
  const lines = wrap("a very long label that will never fit in a tiny box", 13, 60, 2);
  expect(lines).toHaveLength(2);
  expect(lines[1]!.endsWith("…")).toBe(true);
});

describe("text scales with node size (B3)", () => {
  const fontOf = (svg: string, id: string): number => {
    const g = svg.slice(svg.indexOf(`data-id="${id}"`));
    return Number(/<text [^>]*font-size="([\d.]+)"/.exec(g)![1]);
  };

  test("default-size nodes use the theme font size", async () => {
    const { svg } = await compile(SRC);
    expect(fontOf(svg, "api")).toBe(13);
  });

  test("a node at 2x its default size renders a larger font; clamped to 0.75x-2x", async () => {
    const { model, profile, layout } = await compile(SRC);
    const base = layout.nodes.api!;
    layout.nodes.api = { ...base, w: base.w * 2, h: base.h * 2 };
    expect(fontOf(renderSvg(model, profile, layout), "api")).toBe(26);
    layout.nodes.api = { ...base, w: base.w * 5, h: base.h * 5 };
    expect(fontOf(renderSvg(model, profile, layout), "api")).toBe(26);
    layout.nodes.api = { ...base, w: base.w * 0.5, h: base.h * 0.5 };
    expect(fontOf(renderSvg(model, profile, layout), "api")).toBeCloseTo(9.8, 1);
  });

  test("scale follows the smaller ratio (wide but not tall stays normal)", () => {
    expect(contentScale({ w: 280, h: 60 }, [140, 60])).toBe(1);
    expect(contentScale({ w: 210, h: 90 }, [140, 60])).toBe(1.5);
  });
});

test("roundedPath never rounds into the arrowhead's straight run", () => {
  // Last segment is 16px: with an end arrow (12px) the last corner radius is capped at 4.
  const d = roundedPath([[0, 0], [100, 0], [100, 16]], 6, { end: true });
  expect(d).toContain("L96 0 Q100 0 100 4");
  expect(roundedPath([[0, 0], [100, 0], [100, 16]], 6)).toContain("L94 0 Q100 0 100 6");
});

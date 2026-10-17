// Routing quality on the real examples (B1: arrowheads never sit on a bend; B2: lines never
// run along container borders). Fresh layouts, so the examples' saved layouts don't matter.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARROW_STUB, BORDER_GAP, type Point } from "@spider/layout";
import { compile } from "../src/compile.ts";

const EXAMPLES = ["checkout", "platform", "signup-flow", "kubernetes"];
const EXAMPLES_DIR = join(import.meta.dir, "../../../examples");
const searchPaths = [EXAMPLES_DIR, join(EXAMPLES_DIR, "profiles")];
const len = (a: Point, b: Point): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

describe.each(EXAMPLES)("%s", (name) => {
  const text = readFileSync(join(EXAMPLES_DIR, `${name}.spd`), "utf8");

  test("B1: every arrow end has a straight run of at least arrowhead + 12px", async () => {
    const { model, profile, layout } = await compile(text, { reset: true, searchPaths });
    const bad: string[] = [];
    for (const e of model.edges.values()) {
      const pts = layout.edges[e.id]?.points ?? [];
      if (pts.length < 2) continue;
      const kind = profile.edges[e.kind ?? profile.defaultEdge ?? ""];
      const arrow = kind?.arrow ?? "end";
      const end = len(pts[pts.length - 2]!, pts[pts.length - 1]!);
      const start = len(pts[0]!, pts[1]!);
      if ((arrow === "end" || arrow === "both") && end < ARROW_STUB) bad.push(`${e.id} end=${end}`);
      if ((arrow === "start" || arrow === "both") && start < ARROW_STUB) bad.push(`${e.id} start=${start}`);
    }
    expect(bad).toEqual([]);
  });

  test("B2: no segment runs along a container border", async () => {
    const { model, layout } = await compile(text, { reset: true, searchPaths });
    const borders = [...model.nodes.values()]
      .filter((n) => n.isContainer)
      .flatMap((n) => {
        const l = layout.nodes[n.id]!;
        return [
          { id: n.id, ax: 1, c: l.y, lo: l.x, hi: l.x + l.w },
          { id: n.id, ax: 1, c: l.y + l.h, lo: l.x, hi: l.x + l.w },
          { id: n.id, ax: 0, c: l.x, lo: l.y, hi: l.y + l.h },
          { id: n.id, ax: 0, c: l.x + l.w, lo: l.y, hi: l.y + l.h },
        ];
      });
    const bad: string[] = [];
    for (const [id, el] of Object.entries(layout.edges)) {
      const P = el.points;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i]!, b = P[i + 1]!;
        const ax = a[0] === b[0] ? 0 : 1;
        const lo = Math.min(a[1 - ax]!, b[1 - ax]!), hi = Math.max(a[1 - ax]!, b[1 - ax]!);
        for (const br of borders) {
          if (br.ax === ax && Math.abs(br.c - a[ax]!) < BORDER_GAP && Math.min(hi, br.hi) - Math.max(lo, br.lo) > 0) {
            bad.push(`${id} seg ${i} along ${br.id}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

test("kubernetes example: custom profile loads with no diagnostics", async () => {
  const text = readFileSync(join(EXAMPLES_DIR, "kubernetes.spd"), "utf8");
  const { diagnostics, profile } = await compile(text, { reset: true, searchPaths });
  expect(diagnostics).toEqual([]);
  expect(profile.nodes["k8s.deployment"]?.iconSvg).toContain("<svg");
  expect(profile.edges["k8s.mounts"]?.style).toBe("dotted");
});

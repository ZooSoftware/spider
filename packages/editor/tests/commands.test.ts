import { describe, expect, test } from "bun:test";
import { addEdge, applyTextEdits } from "@spider/core";
import { DEFAULT_NODE_SIZE } from "@spider/profile-schema";
import { analyze } from "@spider/engine";
import { loadProfiles } from "@spider/profiles";
import { isOrthogonal } from "@spider/layout";
import {
  acceptsChildren,
  containerAt,
  dragEnd,
  dragSegment,
  dropRedundantMin,
  droppedNodeBox,
  edgeSnapshot,
  hasCustomRoute,
  moveNodes,
  nextEdgeId,
  relayout,
  renameInLayout,
  resetRoute,
  resizeNode,
  subtree,
  unpin,
  type Scene,
} from "../src/commands.ts";

const SRC = `use base/architecture
zone vpc "VPC" {
  service api "API"
  db store "Store"
}
service web "Web"
web -> api
api -> store "SQL"
`;

async function scene(text = SRC): Promise<Scene> {
  const a = await analyze(text, (uses) => loadProfiles(uses));
  return { model: a.model, profile: a.profile, layout: a.layout };
}

const others = (s: Scene, except: string[]) =>
  JSON.stringify(Object.entries(s.layout.nodes).filter(([id]) => !except.includes(id)));

describe("containers", () => {
  test("subtree, acceptsChildren and the innermost container under a point", async () => {
    const s = await scene();
    expect(subtree(s.model, "vpc").sort()).toEqual(["api", "store", "vpc"]);
    expect(acceptsChildren(s, "vpc")).toBe(true);
    expect(acceptsChildren(s, "api")).toBe(false);
    const v = s.layout.nodes.vpc!;
    expect(containerAt(s, { x: v.x + 2, y: v.y + 2 })).toBe("vpc");
    expect(containerAt(s, { x: v.x + 2, y: v.y + 2 }, new Set(["vpc"]))).toBeUndefined();
    expect(containerAt(s, { x: v.x - 50, y: v.y - 50 })).toBeUndefined();
  });
});

describe("move and resize", () => {
  test("moving a container moves its children; nothing else moves", async () => {
    const s = await scene();
    const before = others(s, ["vpc", "api", "store"]);
    const ids = subtree(s.model, "vpc");
    const orig = new Map(ids.map((i) => [i, { ...s.layout.nodes[i]! }]));
    moveNodes(s.layout, orig, 30.4, -10.6);
    for (const i of ids) {
      expect(s.layout.nodes[i]!.x).toBe(Math.round(orig.get(i)!.x + 30.4));
      expect(s.layout.nodes[i]!.y).toBe(Math.round(orig.get(i)!.y - 10.6));
    }
    relayout(s);
    expect(others(s, ["vpc", "api", "store"])).toBe(before);
  });

  test("resizing a node pins it, with a minimum size", async () => {
    const s = await scene();
    const o = { ...s.layout.nodes.web! };
    resizeNode(s, "web", o, 40, 10);
    expect(s.layout.nodes.web).toMatchObject({ w: o.w + 40, h: o.h + 10, pinned: true });
    resizeNode(s, "web", o, -1000, -1000);
    expect(s.layout.nodes.web).toMatchObject({ w: 40, h: 30 });
  });

  test("resizing a container sets a minimum; dragged back below the content it is dropped", async () => {
    const s = await scene();
    const o = { ...s.layout.nodes.vpc! };
    resizeNode(s, "vpc", o, 100, 50);
    expect(s.layout.nodes.vpc).toMatchObject({ w: o.w, minW: o.w + 100, minH: o.h + 50, pinned: true });
    relayout(s);
    expect(s.layout.nodes.vpc!.w).toBe(o.w + 100);
    dropRedundantMin(s, "vpc");
    expect(s.layout.nodes.vpc!.minW).toBe(o.w + 100);

    resizeNode(s, "vpc", o, -500, -500);
    relayout(s);
    dropRedundantMin(s, "vpc");
    expect(s.layout.nodes.vpc!.minW).toBeUndefined();
    expect(s.layout.nodes.vpc!.minH).toBeUndefined();
    expect(s.layout.nodes.vpc!.w).toBe(o.w);
  });
});

describe("lines", () => {
  test("dragging a segment makes a manual, orthogonal route and keeps the label on it", async () => {
    const s = await scene();
    const id = "api->store";
    const orig = edgeSnapshot(s.layout.edges[id]!);
    const k = Math.floor((orig.points.length - 1) / 2);
    const [a, b] = [orig.points[k]!, orig.points[k + 1]!];
    const vertical = a[0] === b[0];
    dragSegment(s, id, orig, k, { x: a[0] + (vertical ? 37 : 0), y: a[1] + (vertical ? 0 : 37) });
    const e = s.layout.edges[id]!;
    expect(e.manual).toBe(true);
    expect(isOrthogonal(e.points)).toBe(true);
    expect(e.labelPos).toBeDefined();
    expect(hasCustomRoute(e)).toBe(true);
    // The drag started from a snapshot: the original route is untouched.
    expect(orig.points).toEqual(edgeSnapshot(orig).points);
  });

  test("dragging an end onto another side stores the port and routes automatically", async () => {
    const s = await scene();
    const id = "web->api";
    const orig = edgeSnapshot(s.layout.edges[id]!);
    const t = s.layout.nodes.api!;
    const sides: [string, { x: number; y: number }][] = [
      ["top", { x: t.x + t.w / 2, y: t.y }],
      ["bottom", { x: t.x + t.w / 2, y: t.y + t.h }],
    ];
    const end = orig.points[orig.points.length - 1]!;
    const [side, p] = sides.find(([, q]) => Math.abs(q.y - end[1]) > 1)!;
    dragEnd(s, id, orig, "target", p);
    const e = s.layout.edges[id]!;
    expect(e.targetPort as string).toBe(side);
    expect(e.manual).toBeUndefined();
    expect(isOrthogonal(e.points)).toBe(true);

    expect(resetRoute(s, id)).toBe(true);
    expect(hasCustomRoute(s.layout.edges[id])).toBe(false);
    expect(resetRoute(s, "nope")).toBe(false);
  });
});

describe("ids and new nodes", () => {
  test("renaming re-keys the node and its lines", async () => {
    const s = await scene();
    const l = renameInLayout(s.layout, "api", "gateway");
    expect(l.nodes.gateway).toEqual(s.layout.nodes.api!);
    expect(l.nodes.api).toBeUndefined();
    expect(Object.keys(l.edges).sort()).toEqual(["gateway->store", "web->gateway"]);
  });

  test("nextEdgeId matches the id addEdge creates", async () => {
    const s = await scene();
    expect(nextEdgeId(s.model, "web", "store")).toBe("web->store");
    expect(nextEdgeId(s.model, "web", "api")).toBe("web->api#2");
    const again = await scene(applyTextEdits(SRC, addEdge(SRC, "web", "api")));
    expect(again.model.edges.has("web->api#2")).toBe(true);
  });

  test("a dropped node is centred on the pointer, with its kind's size, pinned", async () => {
    const s = await scene();
    const [w, h] = s.profile.nodes.service?.size ?? DEFAULT_NODE_SIZE;
    expect(droppedNodeBox(s.profile, "service", { x: 100, y: 100 })).toEqual({ x: Math.round(100 - w / 2), y: Math.round(100 - h / 2), w, h, pinned: true });
    expect(droppedNodeBox(s.profile, "unknown", { x: 0, y: 0 }).pinned).toBe(true);
  });

  test("unpin one node or all", async () => {
    const s = await scene();
    for (const n of Object.values(s.layout.nodes)) n.pinned = true;
    unpin(s.layout, "web");
    expect(s.layout.nodes.web!.pinned).toBeUndefined();
    expect(s.layout.nodes.api!.pinned).toBe(true);
    unpin(s.layout);
    expect(Object.values(s.layout.nodes).some((n) => n.pinned)).toBe(false);
  });
});

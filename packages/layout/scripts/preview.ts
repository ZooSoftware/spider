// Debug preview: lay out a hand-built ~15-node diagram (container, parallel edges, self-loop),
// then add two nodes incrementally, and write crude SVGs (+ PNGs if ImageMagick/rsvg exist).
// Usage: bun packages/layout/scripts/preview.ts [outDir]
import { layoutDiagram, routeEdges } from "../src/index.ts";
import { buildModel, buildProfile, debugSvg, type EdgeSpec, type NodeSpec } from "../tests/test-utils.ts";

const outDir = process.argv[2] ?? "/tmp/claude-1000/-mnt-data-personal-my-tool-spider/faa43d83-0d8c-4f09-8a10-b89affddbbfb/scratchpad";

const profile = buildProfile({
  user: { size: [60, 60], label: "below", layout: { layer: "first" } },
  db: { size: [110, 70], label: "below" },
  external: { layout: { layer: "last" } },
  queue: { size: [120, 50], ports: ["left", "right"] },
  zone: { container: true, label: "top" },
});

const nodes: NodeSpec[] = [
  { id: "user", kind: "user" },
  { id: "web" },
  { id: "api" },
  { id: "auth" },
  { id: "vpc", kind: "zone", container: true },
  { id: "order", parent: "vpc" },
  { id: "payment", parent: "vpc" },
  { id: "inventory", parent: "vpc" },
  { id: "orders_db", kind: "db", parent: "vpc" },
  { id: "cache", parent: "vpc" },
  { id: "queue", kind: "queue" },
  { id: "worker" },
  { id: "stripe", kind: "external" },
  { id: "email", kind: "external" },
  { id: "analytics" },
];
const edges: EdgeSpec[] = [
  ["user", "web", "HTTPS"], ["web", "api"], ["api", "auth"], ["api", "order", "REST"], ["api", "payment"],
  ["api", "inventory"], ["order", "orders_db"], ["order", "queue", "events"], ["order", "payment"], ["order", "payment"],
  ["payment", "stripe", "charge"], ["payment", "stripe"], ["stripe", "payment", "webhook"], ["queue", "worker"],
  ["worker", "email"], ["worker", "analytics"], ["inventory", "cache"], ["inventory", "orders_db"],
  ["analytics", "orders_db"], ["order", "order"], ["auth", "cache"],
];

async function write(name: string, svg: string): Promise<void> {
  const svgPath = `${outDir}/${name}.svg`, pngPath = `${outDir}/${name}.png`;
  await Bun.write(svgPath, svg);
  for (const cmd of [["rsvg-convert", "-o", pngPath, svgPath], ["magick", svgPath, pngPath]]) {
    if (!Bun.which(cmd[0]!)) continue;
    const p = Bun.spawnSync(cmd);
    if (p.exitCode === 0) { console.log("wrote", pngPath); return; }
  }
  console.log("wrote", svgPath);
}

const model = buildModel(nodes, edges);
const full = await layoutDiagram(model, profile);
const t0 = performance.now();
routeEdges(model, profile, full.nodes, full.edges);
console.log(`routeEdges: ${(performance.now() - t0).toFixed(2)}ms`);
await write("layout-preview", debugSvg(model, full));
if (process.env.DUMP) console.log(JSON.stringify(full, null, 0));

// Incremental: pin api, add two nodes, re-layout.
full.nodes.api!.pinned = true;
const model2 = buildModel(
  [...nodes, { id: "fraud", parent: "vpc" }, { id: "audit" }],
  [...edges, ["payment", "fraud"], ["fraud", "audit"], ["api", "audit"]],
);
const inc = await layoutDiagram(model2, profile, full);
await write("layout-preview-incremental", debugSvg(model2, inc));

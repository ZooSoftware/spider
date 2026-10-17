import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { emptyProfile, loadProfiles } from "@spider/profiles";
import { allDiagnostics, analyze, type LoadedProfile } from "../src/index.ts";
import { compile, layoutPathFor, profileSearchPaths, searchPathsFor } from "../src/node.ts";

const SRC = `use base/architecture
zone vpc "VPC" {
  service api "API"
}
service web "Web"
web -> api
`;

const fromDisk = (uses: Parameters<typeof loadProfiles>[0]) => loadProfiles(uses);

describe("analyze", () => {
  test("parses, loads profiles through the source and lays out every node and edge", async () => {
    const seen: string[] = [];
    const a = await analyze(SRC, async (uses) => {
      seen.push(...uses.map((u) => u.profile));
      return fromDisk(uses);
    });
    expect(seen).toEqual(["base/architecture"]);
    expect(Object.keys(a.layout.nodes).sort()).toEqual(["api", "vpc", "web"]);
    expect(Object.keys(a.layout.edges)).toEqual(["web->api"]);
    expect(a.profile.nodes.service).toBeDefined();
  });

  test("passes the source's extra fields back as `loaded`", async () => {
    const a = await analyze(SRC, async (uses) => ({ ...(await fromDisk(uses)), key: "k1" }));
    expect(a.loaded.key).toBe("k1");
  });

  test("model diagnostics: parse, profile and rule problems", async () => {
    const source = async (): Promise<LoadedProfile> => ({
      profile: emptyProfile(),
      diagnostics: [{ severity: "error", code: "profile/not-found", message: "x", span: { start: 0, end: 3 } }],
    });
    const a = await analyze(`use nope\nservice a "A" {\n`, source);
    const codes = a.diagnostics.map((d) => d.code);
    expect(codes).toContain("profile/not-found");
    expect(codes.some((c) => c.startsWith("parse/"))).toBe(true);
  });

  test("keeps the previous layout; a function gets the parsed model", async () => {
    const first = await analyze(SRC, fromDisk);
    const moved = { ...first.layout, nodes: { ...first.layout.nodes, web: { ...first.layout.nodes.web!, x: 999, pinned: true } } };
    let modelIds: string[] = [];
    const again = await analyze(SRC, fromDisk, {
      previous: (model) => {
        modelIds = [...model.nodes.keys()];
        return moved;
      },
    });
    expect(modelIds.sort()).toEqual(["api", "vpc", "web"]);
    expect(again.layout.nodes.web!.x).toBe(999);
    const reset = await analyze(SRC, fromDisk, { previous: moved, reset: true });
    expect(reset.layout.nodes.web!.x).not.toBe(999);
  });

  test("allDiagnostics adds layout warnings and sorts by position", async () => {
    const a = await analyze(SRC, fromDisk);
    const vpc = a.layout.nodes.vpc!;
    // Put `web` (not inside the zone) on top of it.
    a.layout.nodes.web = { ...a.layout.nodes.web!, x: vpc.x + 5, y: vpc.y + 5 };
    const all = allDiagnostics(a);
    expect(all.map((d) => d.code)).toContain("layout/overlaps-container");
    const starts = all.map((d) => d.span?.start ?? 0);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });
});

describe("engine/node", () => {
  test("compile renders SVG with all diagnostics", async () => {
    const r = await compile(SRC);
    expect(r.svg).toStartWith("<svg");
    expect(r.svg).toContain('data-id="web"');
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("file conventions", () => {
    expect(layoutPathFor("a/b.spd")).toBe(resolve("a/b.spd") + ".layout.json");
    expect(profileSearchPaths("/d")).toEqual(["/d", "/d/profiles", resolve("profiles")]);
    expect(searchPathsFor("/d/x.spd")[0]).toBe("/d");
    expect(searchPathsFor(join("rel", "x.spd"))[0]).toBe(resolve("rel"));
  });
});

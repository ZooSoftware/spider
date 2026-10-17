import { describe, expect, test } from "bun:test";
import { analyze } from "@spider/engine";
import { loadProfiles } from "@spider/profiles";
import type { Scene } from "../src/commands.ts";
import { profileKey, remapProfileDiagnostics, type ProfileCache } from "../src/io.ts";
import { overlay, type OverlayState } from "../src/overlay.ts";

const SRC = `use base/architecture
zone vpc "VPC" {
  service api "API"
}
service web "Web"
web -> api
`;

async function scene(): Promise<Scene> {
  const a = await analyze(SRC, (uses) => loadProfiles(uses));
  return { model: a.model, profile: a.profile, layout: a.layout };
}

const none: OverlayState = { selected: undefined, dropTarget: undefined, connect: undefined };
const count = (svg: string, cls: string): number => svg.split(`class="${cls}`).length - 1;

describe("overlay", () => {
  test("nothing selected: an empty group", async () => {
    expect(overlay(await scene(), none)).toBe(`<g class="spd-overlay"></g>`);
  });

  test("pins, drop target and overlap warnings", async () => {
    const s = await scene();
    s.layout.nodes.web!.pinned = true;
    const v = s.layout.nodes.vpc!;
    s.layout.nodes.web = { ...s.layout.nodes.web!, x: v.x + 4, y: v.y + 4 };
    const svg = overlay(s, { ...none, dropTarget: "vpc" });
    expect(count(svg, "spd-pin")).toBe(1);
    expect(count(svg, "spd-drop")).toBe(1);
    expect(svg).toContain(`class="spd-warn"`);
    expect(svg).toContain(`Overlaps "vpc"`);
  });

  test("a selected node gets a resize handle and a connect handle", async () => {
    const svg = overlay(await scene(), { ...none, selected: { type: "node", id: "web" } });
    expect(svg).toContain(`class="spd-handle" data-id="web"`);
    expect(svg).toContain(`class="spd-connect" data-id="web"`);
  });

  test("while connecting: a preview line, the hovered node, no connect handle", async () => {
    const svg = overlay(await scene(), {
      selected: { type: "node", id: "web" },
      dropTarget: undefined,
      connect: { from: "web", pointer: { x: 5, y: 6 }, over: "api" },
    });
    expect(svg).toContain(`class="spd-preview"`);
    expect(svg).toContain(`x2="5" y2="6"`);
    expect(count(svg, "spd-drop")).toBe(1);
    expect(svg).not.toContain("spd-connect");
  });

  test("a selected line gets a handle per segment and on both ends", async () => {
    const s = await scene();
    const pts = s.layout.edges["web->api"]!.points;
    const svg = overlay(s, { ...none, selected: { type: "edge", id: "web->api" } });
    expect(count(svg, "spd-seg")).toBe(pts.length - 1);
    expect(svg).toContain(`data-end="source"`);
    expect(svg).toContain(`data-end="target"`);
  });

  test("manual lines get a marker unless selected", async () => {
    const s = await scene();
    s.layout.edges["web->api"]!.manual = true;
    expect(count(overlay(s, none), "spd-manual")).toBe(1);
    expect(count(overlay(s, { ...none, selected: { type: "edge", id: "web->api" } }), "spd-manual")).toBe(0);
  });
});

describe("profile diagnostics", () => {
  test("follow their `use` declaration when the code above it changes", () => {
    const uses = [{ profile: "nope", span: { start: 0, end: 8 } }];
    const cache: ProfileCache = {
      key: profileKey(uses),
      profile: { sources: [], nodes: {}, edges: {}, rules: [], theme: {}, layout: {} },
      diagnostics: [{ severity: "error", code: "profile/not-found", message: "x", span: { start: 0, end: 8 } }],
      uses,
    };
    const moved = [{ profile: "nope", span: { start: 10, end: 18 } }];
    expect(profileKey(moved)).toBe(cache.key);
    expect(remapProfileDiagnostics(cache, moved)[0]!.span).toEqual({ start: 10, end: 18 });
  });
});

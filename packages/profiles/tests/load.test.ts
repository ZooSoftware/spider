import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadProfiles, versionMatches } from "../src/load.ts";
import { use } from "./test-helpers.ts";

const FIX = join(import.meta.dir, "..", "fixtures");
const opts = { searchPaths: [FIX] };
const codes = (d: { code: string }[]) => d.map((x) => x.code);

describe("loadProfiles", () => {
  test("no use → empty profile + info", async () => {
    const { profile, diagnostics } = await loadProfiles([]);
    expect(profile.nodes).toEqual({});
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("info");
  });

  test("loads built-in base/architecture with sanitized icons", async () => {
    const { profile, diagnostics } = await loadProfiles([use("base/architecture")]);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(profile.nodes).sort()).toEqual(
      ["cache", "db", "external", "function", "group", "queue", "service", "storage", "user", "zone"],
    );
    expect(Object.keys(profile.edges).sort()).toEqual(["async", "calls", "data"]);
    expect(profile.defaultEdge).toBe("calls");
    expect(profile.layout.direction).toBe("RIGHT");
    expect(profile.nodes.db!.layout?.layer).toBe("last");
    expect(profile.nodes.user!.layout?.layer).toBe("first");
    expect(profile.nodes.zone!.container).toBe(true);
    for (const k of Object.values(profile.nodes)) {
      expect(k.description).toBeTruthy();
      expect(k.iconSvg).toStartWith("<svg");
      expect(k.iconSvg).toContain('viewBox="0 0 24 24"');
      expect(k.iconSvg).toContain("currentColor");
    }
    expect(profile.rules).toEqual([{ forbid: "user -> db", message: "Users must not access databases directly", severity: "warning" }]);
    expect(profile.sources).toEqual([{ name: "base/architecture", version: "0.1.0" }]);
  });

  test("loads built-in base/flowchart", async () => {
    const { profile, diagnostics } = await loadProfiles([use("base/flowchart")]);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(profile.nodes).sort()).toEqual(["decision", "end", "io", "process", "start"]);
    expect(profile.nodes.decision!.shape).toBe("diamond");
    expect(profile.defaultEdge).toBe("flow");
    expect(profile.layout.direction).toBe("DOWN");
  });

  test("search paths take precedence over built-ins", async () => {
    const read = async (p: string) => (p.startsWith("/user/base/flowchart") ? "name: base/flowchart\nversion: 9.0.0\n" : undefined);
    const { profile } = await loadProfiles([use("base/flowchart")], { searchPaths: ["/user"], readFile: read });
    expect(profile.sources[0]!.version).toBe("9.0.0");
    expect(profile.nodes).toEqual({});
  });

  test("extends: child overrides per kind, merges props/style, concatenates rules", async () => {
    const { profile, diagnostics } = await loadProfiles([use("acme/cloud")], opts);
    expect(diagnostics).toEqual([]);
    const svc = profile.nodes.service!;
    expect(svc.shape).toBe("rect");
    expect(svc.description).toContain("deployable"); // inherited
    expect(svc.props).toEqual({ tech: "string", owner: "string", replicas: "number", lang: "string" });
    expect(svc.style).toEqual({ stroke: "#2563eb", fill: "#eef" });
    expect(svc.iconSvg).toContain("<svg"); // parent icon kept
    expect(profile.nodes.db!.shape).toBe("cylinder");
    expect(profile.edges.async).toMatchObject({ style: "dashed", allowed: ["lambda -> queue"] });
    expect(profile.rules.map((r) => r.forbid)).toEqual(["user -> db", "external -> db"]);
    expect(profile.rules[1]!.severity).toBe("error"); // schema default
    expect(profile.theme.nodeFill).toBe("#fafafa");
    expect(profile.theme.fontSize).toBe(13);
    expect(profile.layout).toMatchObject({ direction: "DOWN", nodeSpacing: 40 });
  });

  test("child icon is loaded relative to the child and sanitized", async () => {
    const { profile } = await loadProfiles([use("acme/cloud")], opts);
    const svg = profile.nodes.lambda!.iconSvg!;
    expect(svg).toStartWith("<svg");
    expect(svg).not.toContain("script");
    expect(svg).not.toContain("onload");
    expect(svg).not.toContain("<?xml");
    expect(svg).not.toContain("DOCTYPE");
    expect(svg).toContain("<path");
  });

  test("multiple extends: later parent wins, child last", async () => {
    const { profile } = await loadProfiles([use("multi/c")], opts);
    expect(profile.nodes.x).toMatchObject({ shape: "circle", description: "from a" });
    expect(profile.nodes.y).toMatchObject({ shape: "rect", description: "from c" });
    expect(profile.theme).toEqual({ fontSize: 12, textColor: "red" });
    expect(profile.defaultEdge).toBe("e");
  });

  test("extends cycle → error, no hang", async () => {
    const { diagnostics } = await loadProfiles([use("cyc/a")], opts);
    const cyc = diagnostics.find((d) => d.code === "profile/extends-cycle");
    expect(cyc?.severity).toBe("error");
    expect(cyc?.message).toContain("cyc/a -> cyc/b -> cyc/a");
    expect(cyc?.span).toEqual({ start: 0, end: 10 });
  });

  test("alias namespaces kinds, edges, allows, allowed pairs, rules and defaultEdge", async () => {
    const { profile, diagnostics } = await loadProfiles([use("base/architecture"), use("k8s", { alias: "k8s" })], opts);
    expect(diagnostics).toEqual([]);
    expect(profile.nodes["k8s.pod"]?.kind).toBe("k8s.pod");
    expect(profile.nodes.service?.kind).toBe("service"); // no clash thanks to alias
    expect(profile.nodes["k8s.service"]).toBeDefined();
    expect(profile.nodes["k8s.namespace"]!.allows).toEqual(["k8s.pod", "k8s.service"]);
    expect(profile.edges["k8s.routes"]!.allowed).toEqual(["k8s.service -> k8s.pod"]);
    expect(profile.defaultEdge).toBe("k8s.routes");
    expect(profile.rules.map((r) => r.forbid)).toEqual(["user -> db", "k8s.pod -> *"]);
    expect(profile.sources[1]).toEqual({ name: "k8s", version: "2.0.0", alias: "k8s" });
  });

  test("kind clash between un-aliased profiles → warning, later wins", async () => {
    const { profile, diagnostics } = await loadProfiles([use("base/architecture"), use("k8s", {}, 20)], opts);
    const clash = diagnostics.filter((d) => d.code === "profile/kind-clash");
    expect(clash).toHaveLength(1);
    expect(clash[0]!.severity).toBe("warning");
    expect(clash[0]!.message).toContain('"service"');
    expect(clash[0]!.span).toEqual({ start: 20, end: 30 });
    expect(profile.nodes.service!.description).toBe("A k8s service.");
  });

  test("duplicate use → warning, loaded once", async () => {
    const { diagnostics, profile } = await loadProfiles([use("base/flowchart"), use("base/flowchart")]);
    expect(codes(diagnostics)).toEqual(["profile/duplicate-use"]);
    expect(profile.sources).toHaveLength(1);
  });

  test("version: prefix match on dot segments", async () => {
    expect(versionMatches("1.2", "1.2.3")).toBe(true);
    expect(versionMatches("1", "1.2.3")).toBe(true);
    expect(versionMatches("1.2.3", "1.2.3")).toBe(true);
    expect(versionMatches("1.2", "1.2.x")).toBe(true);
    expect(versionMatches("1.2", "1.20.0")).toBe(false);
    expect(versionMatches("1.3", "1.2.3")).toBe(false);
    expect(versionMatches("1.2.3.4", "1.2.3")).toBe(false);
    const ok = await loadProfiles([use("acme/cloud", { version: "1.2" })], opts);
    expect(codes(ok.diagnostics)).toEqual([]);
    const bad = await loadProfiles([use("multi/c", { version: "1.2" })], opts);
    expect(codes(bad.diagnostics)).toEqual(["profile/version-mismatch"]);
    expect(bad.diagnostics[0]!.severity).toBe("warning");
    expect(bad.profile.nodes.x).toBeDefined(); // still loaded
  });

  test("missing profile → warning, others still load", async () => {
    const { profile, diagnostics } = await loadProfiles([use("nope/missing"), use("base/flowchart")], opts);
    expect(codes(diagnostics)).toEqual(["profile/not-found"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(profile.nodes.process).toBeDefined();
  });

  test("invalid profile name (path traversal) → error", async () => {
    const { diagnostics } = await loadProfiles([use("../fixtures/k8s")], opts);
    expect(codes(diagnostics)).toEqual(["profile/invalid-name"]);
  });

  test("invalid YAML → error diagnostic with span", async () => {
    const { diagnostics } = await loadProfiles([use("bad/yaml", {}, 5)], opts);
    expect(codes(diagnostics)).toEqual(["profile/invalid-yaml"]);
    expect(diagnostics[0]!.span).toEqual({ start: 5, end: 15 });
    expect(diagnostics[0]!.message).toContain("profile.yaml");
  });

  test("schema errors → one diagnostic per issue, with path", async () => {
    const { diagnostics, profile } = await loadProfiles([use("bad/schema")], opts);
    expect(diagnostics.length).toBe(2);
    expect(diagnostics.every((d) => d.code === "profile/invalid-schema" && d.severity === "error")).toBe(true);
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("nodes.x.shape");
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("rules.0.forbid");
    expect(profile.sources).toEqual([]);
  });

  test("icons outside the profile folder or missing → warnings", async () => {
    const { diagnostics, profile } = await loadProfiles([use("bad/icon")], opts);
    expect(codes(diagnostics).sort()).toEqual(["profile/icon-invalid", "profile/icon-missing"]);
    expect(profile.nodes.a!.iconSvg).toBeUndefined();
  });
});

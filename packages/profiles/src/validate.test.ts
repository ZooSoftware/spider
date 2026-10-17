import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ResolvedProfile } from "@spider/profile-schema";
import { emptyProfile, loadProfiles } from "./load.ts";
import { makeModel, use } from "./test-helpers.ts";
import { validate } from "./validate.ts";

const FIX = join(import.meta.dir, "..", "fixtures");
let arch: ResolvedProfile;
let acme: ResolvedProfile;
let mixed: ResolvedProfile;

beforeAll(async () => {
  arch = (await loadProfiles([use("base/architecture")])).profile;
  acme = (await loadProfiles([use("acme/cloud")], { searchPaths: [FIX] })).profile;
  mixed = (await loadProfiles([use("base/architecture"), use("k8s", { alias: "k8s" })], { searchPaths: [FIX] })).profile;
});

describe("validate", () => {
  test("a valid architecture diagram has no diagnostics", () => {
    const m = makeModel(
      [
        { id: "u", kind: "user" },
        { id: "vpc", kind: "zone" },
        { id: "api", kind: "service", parent: "vpc", props: { tech: "go", replicas: 3 } },
        { id: "orders", kind: "db", parent: "vpc", props: { engine: "postgres" } },
        { id: "q", kind: "queue" },
      ],
      [["u", "api"], ["api", "orders", "calls"], ["api", "q", "async"], ["q", "orders", "data"]],
    );
    expect(validate(m, arch)).toEqual([]);
  });

  test("no profile loaded → no per-node noise", () => {
    expect(validate(makeModel([{ id: "a", kind: "whatever" }]), emptyProfile())).toEqual([]);
  });

  test("unknown node kind → warning with span and suggestion", () => {
    const [d, ...rest] = validate(makeModel([{ id: "a", kind: "servce" }]), arch);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ severity: "warning", code: "profile/unknown-kind", span: { start: 100, end: 109 } });
    expect(d!.message).toContain('did you mean "service"');
  });

  test("child kind not in container allows → error", () => {
    const m = makeModel([
      { id: "v", kind: "vpc" },
      { id: "f", kind: "lambda", parent: "v" },
      { id: "d", kind: "db", parent: "v" },
    ]);
    const ds = validate(m, acme);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: "error", code: "profile/containment", span: { start: 120, end: 129 } });
    expect(ds[0]!.message).toContain('does not allow "db"');
  });

  test("containment with namespaced allows", () => {
    const m = makeModel([
      { id: "ns", kind: "k8s.namespace" },
      { id: "p", kind: "k8s.pod", parent: "ns" },
      { id: "s", kind: "service", parent: "ns" },
    ]);
    expect(validate(m, mixed).map((d) => d.code)).toEqual(["profile/containment"]);
  });

  test("children under a non-container kind → warning", () => {
    const m = makeModel([{ id: "s", kind: "service" }, { id: "d", kind: "db", parent: "s" }]);
    const ds = validate(m, arch);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: "warning", code: "profile/not-container" });
  });

  test("unknown edge kind → warning", () => {
    const m = makeModel([{ id: "a", kind: "service" }, { id: "b", kind: "service" }], [["a", "b", "cals"]]);
    const ds = validate(m, arch);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: "warning", code: "profile/unknown-edge-kind", span: { start: 1000, end: 1009 } });
    expect(ds[0]!.message).toContain('did you mean "calls"');
  });

  test("edge kind with allowed pairs → error when not matching", () => {
    const m = makeModel(
      [{ id: "f", kind: "lambda" }, { id: "q", kind: "queue" }, { id: "s", kind: "service" }],
      [["f", "q", "async"], ["s", "q", "async"]],
    );
    const ds = validate(m, acme);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: "error", code: "profile/edge-not-allowed" });
    expect(ds[0]!.message).toContain("service -> queue");
  });

  test("allowed pairs apply to the default edge kind when none is written", () => {
    const m = makeModel([{ id: "s", kind: "k8s.service" }, { id: "p", kind: "k8s.pod" }], [["s", "p"], ["p", "s"]]);
    // p -> s fails "allowed" (error) and hits the "k8s.pod -> *" rule (warning)
    const ds = validate(m, mixed); // defaultEdge is k8s.routes (later use wins)
    expect(ds.map((d) => [d.code, d.severity])).toEqual([
      ["profile/edge-not-allowed", "error"],
      ["profile/forbidden", "warning"],
    ]);
  });

  test("forbid rules use their severity and message; wildcards match", () => {
    const m = makeModel(
      [{ id: "u", kind: "user" }, { id: "d", kind: "db" }, { id: "x", kind: "external" }],
      [["u", "d"], ["x", "d", "data"]],
    );
    const ds = validate(m, acme);
    expect(ds.map((d) => [d.code, d.severity])).toEqual([
      ["profile/forbidden", "warning"],
      ["profile/forbidden", "error"],
    ]);
    expect(ds[0]!.message).toContain("Users must not access databases directly");
    expect(ds[1]!.message).toContain("DB must not be exposed");
    expect(ds[1]!.span).toEqual({ start: 1010, end: 1019 });
  });

  test("unknown prop and prop type mismatch → warnings", () => {
    const m = makeModel([{ id: "s", kind: "service", props: { tech: "go", replicas: "three", color: "red" } }]);
    const ds = validate(m, arch);
    expect(ds.map((d) => [d.code, d.severity])).toEqual([
      ["profile/prop-type", "warning"],
      ["profile/unknown-prop", "warning"],
    ]);
    expect(ds[0]!.message).toContain("should be a number, got string");
  });

  test("props are free-form when the kind declares none", () => {
    expect(validate(makeModel([{ id: "s", kind: "storage", props: { anything: true } }]), arch)).toEqual([]);
  });

  test("edges to unknown nodes are left to core", () => {
    expect(validate(makeModel([{ id: "a", kind: "service" }], [["a", "ghost"]]), arch)).toEqual([]);
  });
});

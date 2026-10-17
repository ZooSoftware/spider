import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModel } from "../src/build.ts";

const fixture = (f: string) => readFileSync(join(import.meta.dir, "../fixtures", f), "utf8");
const slice = (src: string, s: { start: number; end: number } | undefined) => (s ? src.slice(s.start, s.end) : "");

test("example fixture: nesting, props, namespaced kinds, uses, edge ids", () => {
  const src = fixture("example.spd");
  const { model, diagnostics } = parseModel(src);
  expect(diagnostics).toEqual([]);
  expect(model.uses.map(({ span, ...u }) => u)).toEqual([
    { profile: "base/architecture", version: undefined, alias: undefined },
    { profile: "mycompany/k8s", version: "1.2", alias: "k8s" },
  ]);
  expect(slice(src, model.uses[1]!.span)).toBe("use mycompany/k8s@1.2 as k8s");
  expect([...model.nodes.keys()]).toEqual(["vpc", "api", "orders_db", "main", "fn", "db", "worker"]);
  expect(model.roots).toEqual(["vpc", "main", "worker"]);
  const vpc = model.nodes.get("vpc")!;
  expect(vpc).toMatchObject({ kind: "zone", label: "VPC", isContainer: true, children: ["api", "orders_db"], props: {} });
  expect(vpc.parent).toBeUndefined();
  expect(model.nodes.get("api")).toMatchObject({
    kind: "service",
    label: "API Gateway",
    parent: "vpc",
    isContainer: false,
    children: [],
    props: { runtime: "node", replicas: 3 },
  });
  expect(model.nodes.get("main")).toMatchObject({ kind: "vpc2", isContainer: true, children: ["fn", "db"] });
  expect(model.nodes.get("worker")).toMatchObject({ kind: "k8s.pod", isContainer: false });
  expect(model.nodes.get("worker")!.label).toBeUndefined();
  expect([...model.edges.values()].map(({ span, ...e }) => e)).toEqual([
    { id: "api->orders_db", source: "api", target: "orders_db", kind: "calls", label: "SQL" },
    { id: "api->worker", source: "api", target: "worker", kind: undefined, label: undefined },
    { id: "api->worker#2", source: "api", target: "worker", kind: undefined, label: undefined },
  ]);
  expect(slice(src, model.edges.get("api->orders_db")!.span)).toBe('api -> orders_db : calls "SQL"');
  expect(slice(src, model.nodes.get("api")!.span)).toBe('service api "API Gateway" { runtime: "node"  replicas: 3 }');
});

test("prop value types and string escapes", () => {
  const { model } = parseModel('n x "a\\"b" { s: "t\\n" i: 42 f: -0.5 t: true b: false }');
  expect(model.nodes.get("x")!.label).toBe('a"b');
  expect(model.nodes.get("x")!.props).toEqual({ s: "t\n", i: 42, f: -0.5, t: true, b: false });
});

test("a block with only props is not a container; mixed props and children is", () => {
  const { model } = parseModel("a x { k: 1 } b y { k: 2 c z { } }");
  expect(model.nodes.get("x")!.isContainer).toBe(false);
  expect(model.nodes.get("y")).toMatchObject({ isContainer: true, children: ["z"], props: { k: 2 } });
  expect(model.nodes.get("z")!.isContainer).toBe(false);
});

test("edge labels without kind, and edges inside blocks are global", () => {
  const { model } = parseModel('z a { s b  b -> c : "REST" } s c\nb -> c "x" b -> c : k');
  expect([...model.edges.keys()]).toEqual(["b->c", "b->c#2", "b->c#3"]);
  expect(model.edges.get("b->c")).toMatchObject({ label: "REST", kind: undefined });
  expect(model.edges.get("b->c#3")).toMatchObject({ kind: "k", label: undefined });
  expect(model.edges.get("c->b")).toBeUndefined();
});

test("duplicate id: error on the second, first kept, children of the duplicate kept", () => {
  const src = 'a x "first"\nzone x "second" { k: 1 a y }';
  const { model, diagnostics } = parseModel(src);
  expect(diagnostics.map((d) => [d.severity, d.code, slice(src, d.span)])).toEqual([
    ["error", "model/duplicate-id", "x"],
  ]);
  expect(diagnostics[0]!.span!.start).toBe(17);
  expect(model.nodes.get("x")).toMatchObject({ label: "first", props: {} });
  expect(model.nodes.get("y")!.parent).toBeUndefined();
  expect(model.roots).toEqual(["x", "y"]);
});

test("unknown edge endpoints: error with span, edge still kept", () => {
  const src = "a x\nx -> ghost\nnope -> x";
  const { model, diagnostics } = parseModel(src);
  expect(diagnostics.map((d) => [d.code, d.span])).toEqual([
    ["model/unknown-node", { start: 9, end: 14 }],
    ["model/unknown-node", { start: 15, end: 19 }],
  ]);
  expect([...model.edges.keys()]).toEqual(["x->ghost", "nope->x"]);
});

test("forward references are fine", () => {
  expect(parseModel("a -> b\ns a s b").diagnostics).toEqual([]);
});

test("duplicate prop key: warning, last value wins", () => {
  const src = "a x { k: 1 k: 2 }";
  const { model, diagnostics } = parseModel(src);
  expect(diagnostics).toEqual([
    { severity: "warning", code: "model/duplicate-prop", message: expect.any(String), span: { start: 11, end: 12 } },
  ]);
  expect(model.nodes.get("x")!.props).toEqual({ k: 2 });
});

test("partial input still yields as much model as possible", () => {
  const { model, diagnostics } = parseModel(fixture("partial.spd"));
  expect(diagnostics.every((d) => d.code.startsWith("parse/"))).toBe(true);
  expect(model.uses.map((u) => u.profile)).toEqual(["base/arch"]);
  expect([...model.nodes.keys()]).toEqual(["vpc", "api", "orders"]);
  expect(model.nodes.get("api")!.props).toEqual({ runtime: "node" });
  expect([...model.edges.keys()]).toEqual(["api->orders"]);
});

test("errors fixture: recovery keeps valid statements", () => {
  const { model } = parseModel(fixture("errors.spd"));
  expect(model.uses).toEqual([]);
  expect(model.nodes.get("api")).toMatchObject({ label: "API", props: { replicas: 3 } });
  expect(model.nodes.get("inner")).toMatchObject({ parent: "z", label: "unterminated" });
  expect(model.edges.get("inner->api")).toMatchObject({ kind: "calls", label: "ok" });
});

test("nodes without an id are transparent; stray blocks keep their content", () => {
  const { model } = parseModel("zone { s a }\n{ s b }\nouter o { { s c } }");
  expect(model.roots).toEqual(["a", "b", "o"]);
  expect(model.nodes.get("c")!.parent).toBe("o");
});

test("unicode labels and CRLF", () => {
  expect(parseModel(fixture("unicode.spd")).model.nodes.get("data")!.label).toBe('Données "quoted" \\ back\nslash');
  const crlf = parseModel(fixture("crlf.spd"));
  expect(crlf.diagnostics).toEqual([]);
  expect(crlf.model.nodes.get("api")!.parent).toBe("vpc");
});

test("empty and trivia-only files", () => {
  for (const f of ["empty.spd", "trivia-only.spd"]) {
    const { model, diagnostics } = parseModel(fixture(f));
    expect(diagnostics).toEqual([]);
    expect(model.nodes.size + model.edges.size + model.uses.length).toBe(0);
  }
});

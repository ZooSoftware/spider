import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type EdgeStmt, indentOf, lineBreakOf, lineSpan, type NodeStmt, print } from "./cst.ts";
import { applyTextEdits } from "./edits.ts";
import { parse } from "./parser.ts";
import { parseModel } from "./build.ts";

const dir = join(import.meta.dir, "../fixtures");
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".spd"))
  .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);
const slice = (src: string, s: { start: number; end: number } | undefined) => (s ? src.slice(s.start, s.end) : "");
const codes = (src: string) => parse(src).diagnostics.map((d) => `${d.code} ${JSON.stringify(slice(src, d.span))}`);

describe("round trip", () => {
  test("fixtures exist", () => expect(fixtures.length).toBeGreaterThanOrEqual(10));
  test.each(fixtures)("%s prints byte-identically", (_, src) => {
    expect(print(parse(src).cst)).toBe(src);
  });
  test.each(fixtures)("%s: every prefix (typing) parses and round-trips", (_, src) => {
    for (let n = 0; n <= src.length; n++) {
      const text = src.slice(0, n);
      expect(print(parseModel(text).cst)).toBe(text);
    }
  });
  test("random mutations round-trip and never throw", () => {
    const alphabet = ['"', "{", "}", ":", "->", "-", ".", "@", "/", "#", "\n", "\r", " ", "x", "1", "é", "\\"];
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (const [, src] of fixtures) {
      for (let k = 0; k < 200; k++) {
        let text = src;
        for (let m = 0; m < 3; m++) {
          const p = rnd(text.length + 1);
          const del = rnd(3);
          text = text.slice(0, p) + alphabet[rnd(alphabet.length)]! + text.slice(p + del);
        }
        expect(print(parseModel(text).cst)).toBe(text);
      }
    }
  });
});

describe("CST shape and spans", () => {
  const src = 'zone vpc "VPC" {\n  service api "API" { port: 80 }\n  api -> vpc : calls "x"\n}\n';
  const { cst, diagnostics } = parse(src);
  const zone = cst.items[0] as NodeStmt;
  const svc = zone.block!.items[0] as NodeStmt;
  const edge = zone.block!.items[1] as EdgeStmt;

  test("no diagnostics", () => expect(diagnostics).toEqual([]));
  test("statement, kind, id, label and brace spans", () => {
    expect(slice(src, zone.span)).toBe(src.slice(0, src.length - 1));
    expect(slice(src, zone.kind.span)).toBe("zone");
    expect(slice(src, zone.id!.span)).toBe("vpc");
    expect(slice(src, zone.label!.span)).toBe('"VPC"');
    expect(slice(src, zone.block!.open.span)).toBe("{");
    expect(zone.block!.close!.span.start).toBe(src.length - 2);
    expect(slice(src, svc.span)).toBe('service api "API" { port: 80 }');
    expect(slice(src, svc.block!.items[0]!.span)).toBe("port: 80");
    expect(slice(src, edge.span)).toBe('api -> vpc : calls "x"');
    expect(slice(src, edge.edgeKind!.span)).toBe("calls");
    expect(slice(src, edge.label!.span)).toBe('"x"');
  });
  test("indentation and full line extent", () => {
    expect(indentOf(src, svc.span)).toBe("  ");
    expect(indentOf(src, zone.span)).toBe("");
    expect(indentOf(src, svc.block!.items[0]!.span)).toBeUndefined();
    expect(slice(src, lineSpan(src, edge.span))).toBe('  api -> vpc : calls "x"\n');
    expect(lineSpan(src, edge.span).ownLine).toBe(true);
    const inner = lineSpan(src, svc.block!.items[0]!.span);
    expect(inner.ownLine).toBe(false);
    expect(slice(src, inner)).toBe("port: 80 ");
  });
  test("namespaced kind, use decl parts", () => {
    const s = "use my/k8s@1.2.0-rc.1 as k\nk8s.pod w";
    const { cst } = parse(s);
    const use = cst.items[0]!;
    expect(use.type).toBe("Use");
    if (use.type !== "Use") return;
    expect(use.profile!.text).toBe("my/k8s");
    expect(use.version!.text).toBe("1.2.0-rc.1");
    expect(use.alias!.text).toBe("k");
    expect((cst.items[1] as NodeStmt).kind.text).toBe("k8s.pod");
    expect(slice(s, (cst.items[1] as NodeStmt).kind.span)).toBe("k8s.pod");
  });
  test("multiple statements per line, keywords by position", () => {
    const { cst, diagnostics } = parse('a b { c d  e f "E" } use -> as as as');
    expect(diagnostics).toEqual([]);
    expect(cst.items.map((i) => i.type)).toEqual(["Node", "Edge", "Node"]);
    expect(((cst.items[0] as NodeStmt).block!.items as NodeStmt[]).map((n) => n.id!.text)).toEqual(["d", "f"]);
  });
});

describe("diagnostics and recovery", () => {
  test("missing parts are reported at the end of the previous token", () => {
    expect(codes("use\nservice api")).toEqual(['parse/expected-profile ""']);
    expect(parse("use\nservice api").diagnostics[0]!.span).toEqual({ start: 3, end: 3 });
    expect(codes("a ->")).toEqual(['parse/expected-target ""']);
    expect(codes("service")).toEqual(['parse/expected-id ""']);
    expect(codes('service "x"')).toEqual(['parse/expected-id "\\"x\\""']);
    expect(codes("k8s.")).toEqual(['parse/expected-kind ""', 'parse/expected-id ""']);
    expect(codes("use a@\nx y")).toEqual(['parse/expected-version ""']);
    expect(codes("use a as")).toEqual(['parse/expected-alias ""']);
    expect(codes("a -> b :\nc d")).toEqual(['parse/expected-edge-kind ""']);
  });
  test("prop errors", () => {
    expect(codes("x y { k: }")).toEqual(['parse/expected-value "}"']);
    expect(codes("x y { k: bare z }")).toEqual(['parse/expected-value "bare"']);
    expect(codes('k: "v"')).toEqual(['parse/prop-outside-block "k: \\"v\\""']);
  });
  test("unexpected tokens are skipped until the next identifier", () => {
    expect(codes('x y 42 "s" $ z w')).toEqual(['parse/unexpected-token "42 \\"s\\" $"']);
    expect(parse('x y 42 "s" $ z w').cst.items.map((i) => i.type)).toEqual(["Node", "Error", "Node"]);
    expect(codes("} a b")).toEqual(['parse/unexpected-close "}"']);
  });
  test("blocks: unclosed and headerless", () => {
    expect(codes("a b {\n c d")).toEqual(['parse/unclosed-block "{"']);
    expect(codes("{ c d }")).toEqual(['parse/unexpected-block "{"']);
  });
  test("unterminated string is reported once", () => {
    expect(codes('a b "open\nc d')).toEqual(['parse/unterminated-string "\\"open"']);
    expect(codes('"open\nc d')).toEqual(['parse/unterminated-string "\\"open"']);
  });
  test("a half-typed line does not swallow the next statement", () => {
    const { model } = parseModel('zone z {\n  service\n  db orders "Orders"\n  api ->\n  orders -> z\n}');
    expect([...model.nodes.keys()]).toEqual(["z", "orders"]);
    expect([...model.edges.keys()]).toEqual(["orders->z"]);
  });
});

describe("write-back by text splicing (Phase 6 groundwork)", () => {
  const src = "zone vpc {\r\n    service api\r\n    db data # keep\r\n}\r\nother x\r\n";
  const { cst } = parse(src);
  const zone = cst.items[0] as NodeStmt;
  const items = zone.block!.items;

  test("insert an edge after the last statement of a block with matching indentation", () => {
    const lastItem = items[items.length - 1]!;
    const at = lineSpan(src, lastItem.span).end;
    const nl = lineBreakOf(src);
    const out = applyTextEdits(src, [
      { span: { start: at, end: at }, newText: `${indentOf(src, lastItem.span)}api -> data${nl}` },
    ]);
    expect(out).toBe("zone vpc {\r\n    service api\r\n    db data # keep\r\n    api -> data\r\n}\r\nother x\r\n");
    expect([...parseModel(out).model.edges.keys()]).toEqual(["api->data"]);
  });
  test("remove a statement including its line", () => {
    const out = applyTextEdits(src, [{ span: lineSpan(src, items[0]!.span), newText: "" }]);
    expect(out).toBe("zone vpc {\r\n    db data # keep\r\n}\r\nother x\r\n");
  });
  test("replace or add a label", () => {
    const node = items[0] as NodeStmt;
    const out = applyTextEdits(src, [{ span: { start: node.id!.span.end, end: node.id!.span.end }, newText: ' "API"' }]);
    expect(parseModel(out).model.nodes.get("api")!.label).toBe("API");
    const out2 = applyTextEdits(out, [{ span: (parse(out).cst.items[0] as NodeStmt).block!.items[0]!.span, newText: 'service api "Gateway"' }]);
    expect(parseModel(out2).model.nodes.get("api")!.label).toBe("Gateway");
    expect(out2.replace('"Gateway"', '"API"')).toBe(out);
  });
});

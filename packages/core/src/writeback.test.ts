import { describe, expect, test } from "bun:test";
import { applyTextEdits } from "./edits.ts";
import { parseModel } from "./build.ts";
import { addEdge, addNode, deleteElements, moveNode, quote, renameEdgeId, renameId, setLabel } from "./writeback.ts";
import type { TextEdit } from "./edits.ts";

const SRC = `use base/architecture

# the VPC
zone vpc "VPC" {
  service api "API"   # entry point
  db store "Store"
}
external stripe "Stripe"

api -> store : data
api -> stripe : "charge"
`;

const apply = (src: string, edits: TextEdit[]): string => applyTextEdits(src, edits);
const clean = (src: string): void => {
  const { diagnostics } = parseModel(src);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
};

describe("addEdge", () => {
  test("appends after the last top-level edge", () => {
    const out = apply(SRC, addEdge(SRC, "stripe", "store"));
    expect(out).toBe(SRC.replace(`"charge"\n`, `"charge"\nstripe -> store\n`));
    clean(out);
  });

  test("kind and label are written and quoted", () => {
    const out = apply(SRC, addEdge(SRC, "api", "stripe", { kind: "async", label: 'say "hi"' }));
    expect(out).toContain(`api -> stripe : async "say \\"hi\\""\n`);
    clean(out);
  });

  test("works without trailing newline, with CRLF, and in an empty file", () => {
    expect(apply("service a\nservice b", addEdge("service a\nservice b", "a", "b"))).toBe("service a\nservice b\na -> b");
    const crlf = "service a\r\nservice b\r\n";
    expect(apply(crlf, addEdge(crlf, "a", "b"))).toBe("service a\r\nservice b\r\na -> b\r\n");
    expect(apply("", addEdge("", "a", "b"))).toBe("a -> b\n");
  });

  test("duplicate edges get a new id", () => {
    const out = apply(SRC, addEdge(SRC, "api", "store"));
    expect([...parseModel(out).model.edges.keys()]).toContain("api->store#2");
  });
});

describe("addNode", () => {
  test("top level: after the last top-level node", () => {
    const { edits, id } = addNode(SRC, { kind: "queue", label: "Events" });
    expect(id).toBe("queue1");
    expect(apply(SRC, edits)).toContain(`external stripe "Stripe"\nqueue queue1 "Events"\n`);
  });

  test("into a container, with its indentation", () => {
    const { edits } = addNode(SRC, { kind: "cache", id: "c", parent: "vpc" });
    const out = apply(SRC, edits);
    expect(out).toContain(`  db store "Store"\n  cache c\n}`);
    expect(parseModel(out).model.nodes.get("c")?.parent).toBe("vpc");
  });

  test("into a node without a block creates one", () => {
    const { edits } = addNode(SRC, { kind: "service", id: "s", parent: "stripe" });
    const out = apply(SRC, edits);
    expect(out).toContain(`external stripe "Stripe" {\n  service s\n}\n`);
    expect(parseModel(out).model.nodes.get("s")?.parent).toBe("stripe");
  });

  test("into an empty one-line block", () => {
    const src = `zone z "Z" {}\n`;
    const out = apply(src, addNode(src, { kind: "service", id: "a", parent: "z" }).edits);
    expect(out).toBe(`zone z "Z" {\n  service a\n}\n`);
  });

  test("ids are unique and namespaced kinds are stripped", () => {
    const src = `service service1\n`;
    expect(addNode(src, { kind: "service" }).id).toBe("service2");
    expect(addNode(src, { kind: "k8s.pod" }).id).toBe("pod1");
  });
});

describe("deleteElements", () => {
  test("deleting a node removes its line and its edges, keeps comments", () => {
    const out = apply(SRC, deleteElements(SRC, { nodes: ["stripe"] }));
    expect(out).not.toContain("stripe");
    expect(out).toContain("# the VPC");
    expect(out).toContain("api -> store : data\n");
    clean(out);
  });

  test("deleting a container removes its block and edges to its children", () => {
    const out = apply(SRC, deleteElements(SRC, { nodes: ["vpc"] }));
    expect(out).toBe(`use base/architecture\n\n# the VPC\nexternal stripe "Stripe"\n\n`);
  });

  test("deleting a child keeps siblings and the trailing comment of the deleted line", () => {
    const out = apply(SRC, deleteElements(SRC, { nodes: ["api"] }));
    expect(out).toContain(`zone vpc "VPC" {\n  db store "Store"\n}`);
    expect(out).not.toContain("api");
  });

  test("deleting an edge removes only that line", () => {
    const out = apply(SRC, deleteElements(SRC, { edges: ["api->stripe"] }));
    expect(out).toBe(SRC.replace(`api -> stripe : "charge"\n`, ""));
  });

  test("statements sharing a line", () => {
    const src = `zone z { service a "A"  service b "B" }\n`;
    const out = apply(src, deleteElements(src, { nodes: ["a"] }));
    expect(out).toBe(`zone z { service b "B" }\n`);
  });
});

describe("setLabel", () => {
  test("replaces, adds and removes node labels", () => {
    expect(apply(SRC, setLabel(SRC, { node: "api" }, "Gateway"))).toContain(`service api "Gateway"   # entry point`);
    const src = "service a\n";
    expect(apply(src, setLabel(src, { node: "a" }, "A"))).toBe(`service a "A"\n`);
    expect(apply(SRC, setLabel(SRC, { node: "stripe" }, ""))).toContain("external stripe\n");
  });

  test("edge labels go after the kind or target", () => {
    expect(apply(SRC, setLabel(SRC, { edge: "api->store" }, "SQL"))).toContain(`api -> store : data "SQL"\n`);
    expect(apply(SRC, setLabel(SRC, { edge: "api->stripe" }, "pay"))).toContain(`api -> stripe : "pay"\n`);
  });

  test("quote escapes", () => {
    expect(quote('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c\\nd"');
  });
});

describe("moveNode", () => {
  test("into a container", () => {
    const out = apply(SRC, moveNode(SRC, "stripe", "vpc"));
    expect(out).toContain(`  db store "Store"\n  external stripe "Stripe"\n}`);
    expect(parseModel(out).model.nodes.get("stripe")?.parent).toBe("vpc");
    clean(out);
  });

  test("out to the top level, keeping its trailing comment", () => {
    const out = apply(SRC, moveNode(SRC, "api", undefined));
    const { model } = parseModel(out);
    expect(model.nodes.get("api")?.parent).toBeUndefined();
    expect(out).toContain(`external stripe "Stripe"\nservice api "API"   # entry point\n`);
    clean(out);
  });

  test("a container with its block is re-indented", () => {
    const src = `zone a "A" {\n  service x\n}\nzone b "B" {\n  service y\n}\n`;
    const out = apply(src, moveNode(src, "a", "b"));
    expect(out).toBe(`zone b "B" {\n  service y\n  zone a "A" {\n    service x\n  }\n}\n`);
    expect(parseModel(out).model.nodes.get("x")?.parent).toBe("a");
  });

  test("refuses to move a node into its own subtree; no-op for same parent", () => {
    expect(() => moveNode(SRC, "vpc", "api")).toThrow();
    expect(moveNode(SRC, "api", "vpc")).toEqual([]);
  });

  test("edges are untouched (ids are global)", () => {
    const out = apply(SRC, moveNode(SRC, "store", undefined));
    expect([...parseModel(out).model.edges.keys()]).toEqual(["api->store", "api->stripe"]);
  });
});

describe("properties over the examples", () => {
  const files = ["checkout", "platform", "signup-flow"].map((f) =>
    require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "../../../examples", `${f}.spd`), "utf8") as string,
  );
  const errors = (src: string) => parseModel(src).diagnostics.filter((d) => d.severity === "error");

  test("moving any node to any valid container keeps all nodes and edges", () => {
    for (const src of files) {
      const { model } = parseModel(src);
      const containers = [undefined, ...[...model.nodes.values()].filter((n) => n.isContainer).map((n) => n.id)];
      for (const id of model.nodes.keys()) {
        for (const target of containers) {
          let edits: TextEdit[];
          try {
            edits = moveNode(src, id, target);
          } catch {
            continue; // into own subtree
          }
          const out = apply(src, edits);
          const m2 = parseModel(out).model;
          expect(errors(out)).toEqual([]);
          expect([...m2.nodes.keys()].sort()).toEqual([...model.nodes.keys()].sort());
          expect([...m2.edges.keys()]).toEqual([...model.edges.keys()]);
          expect(m2.nodes.get(id)?.parent).toBe(edits.length ? target : model.nodes.get(id)?.parent);
        }
      }
    }
  });

  test("deleting any node leaves valid code without that subtree or its edges", () => {
    for (const src of files) {
      const { model } = parseModel(src);
      for (const id of model.nodes.keys()) {
        const out = apply(src, deleteElements(src, { nodes: [id] }));
        const m2 = parseModel(out).model;
        expect(errors(out)).toEqual([]);
        expect(m2.nodes.has(id)).toBe(false);
        for (const e of m2.edges.values()) expect([e.source, e.target]).not.toContain(id);
      }
    }
  });

  test("relabeling every node and edge round-trips through the parser", () => {
    for (const src of files) {
      const { model } = parseModel(src);
      let out = src;
      for (const id of model.nodes.keys()) out = apply(out, setLabel(out, { node: id }, `N ${id} "q"`));
      for (const id of model.edges.keys()) out = apply(out, setLabel(out, { edge: id }, `E ${id}`));
      const m2 = parseModel(out).model;
      expect(errors(out)).toEqual([]);
      for (const id of model.nodes.keys()) expect(m2.nodes.get(id)?.label).toBe(`N ${id} "q"`);
      for (const id of model.edges.keys()) expect(m2.edges.get(id)?.label).toBe(`E ${id}`);
    }
  });
});

describe("blank lines", () => {
  test("removing a statement between blank lines leaves a single blank line", () => {
    const src = `service a\n\nservice b\n\nservice c\n`;
    expect(apply(src, deleteElements(src, { nodes: ["b"] }))).toBe(`service a\n\nservice c\n`);
    const out = apply(src, moveNode(src, "b", "c"));
    expect(out).toBe(`service a\n\nservice c {\n  service b\n}\n`);
  });

  test("a statement directly followed by another keeps the layout", () => {
    const src = `service a\n\nservice b\nservice c\n`;
    expect(apply(src, deleteElements(src, { nodes: ["b"] }))).toBe(`service a\n\nservice c\n`);
  });
});

describe("renameId", () => {
  test("renames the declaration and every edge end, keeps everything else", () => {
    const out = apply(SRC, renameId(SRC, "api", "gateway"));
    expect(out).toContain(`  service gateway "API"   # entry point`);
    expect(out).toContain("gateway -> store : data\n");
    expect(out).toContain(`gateway -> stripe : "charge"\n`);
    expect(out).not.toMatch(/\bapi\b/);
    clean(out);
  });

  test("rejects invalid or taken ids", () => {
    expect(() => renameId(SRC, "api", "store")).toThrow();
    expect(() => renameId(SRC, "api", "9x")).toThrow();
    expect(() => renameId(SRC, "api", "use")).toThrow();
    expect(renameId(SRC, "api", "api")).toEqual([]);
  });

  test("edge ids follow the rename", () => {
    expect(renameEdgeId("a->b", "a", "x")).toBe("x->b");
    expect(renameEdgeId("a->a#2", "a", "x")).toBe("x->x#2");
    expect(renameEdgeId("b->c", "a", "x")).toBe("b->c");
  });
});

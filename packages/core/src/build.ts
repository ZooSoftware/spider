// Model builder: CST → semantic Model with stable ids. Tolerates partial trees: incomplete
// statements are skipped (the parser already reported them), and edges to unknown nodes are kept.

import type { FileNode, Item } from "./cst.ts";
import { stringValue, type Token } from "./lexer.ts";
import { type Diagnostic, edgeId, type Model, type ModelNode, type PropValue } from "./model.ts";
import { parse } from "./parser.ts";

export interface BuildResult {
  model: Model;
  diagnostics: Diagnostic[];
}

export function buildModel(cst: FileNode): BuildResult {
  const model: Model = { uses: [], nodes: new Map(), edges: new Map(), roots: [] };
  const diagnostics: Diagnostic[] = [];
  const ordinals = new Map<string, number>();
  const endpoints: { edge: string; source: Token; target: Token }[] = [];

  function propValue(t: Token): PropValue {
    if (t.kind === "string") return stringValue(t);
    if (t.kind === "number") return Number(t.text);
    return t.text === "true";
  }

  function walk(items: Item[], parent: ModelNode | undefined, props: Map<string, Token> | undefined) {
    for (const item of items) {
      switch (item.type) {
        case "Use":
          if (item.profile)
            model.uses.push({
              profile: item.profile.text,
              version: item.version?.text,
              alias: item.alias?.text,
              span: item.span,
            });
          break;
        case "Prop": {
          if (!parent || !props || !item.value) break;
          const key = item.key.text;
          if (props.has(key))
            diagnostics.push({
              severity: "warning",
              code: "model/duplicate-prop",
              message: `Duplicate property '${key}' on '${parent.id}' (last value wins)`,
              span: item.key.span,
            });
          props.set(key, item.value);
          parent.props[key] = propValue(item.value);
          break;
        }
        case "Edge": {
          if (!item.target) break;
          const s = item.source.text;
          const t = item.target.text;
          const pair = `${s}\u0000${t}`;
          const n = (ordinals.get(pair) ?? 0) + 1;
          ordinals.set(pair, n);
          const id = edgeId(s, t, n);
          model.edges.set(id, {
            id,
            source: s,
            target: t,
            kind: item.edgeKind?.text,
            label: item.label && stringValue(item.label),
            span: item.span,
          });
          endpoints.push({ edge: id, source: item.source, target: item.target });
          break;
        }
        case "Node": {
          let node: ModelNode | undefined;
          if (item.id && model.nodes.has(item.id.text)) {
            diagnostics.push({
              severity: "error",
              code: "model/duplicate-id",
              message: `Duplicate node id '${item.id.text}'`,
              span: item.id.span,
            });
          } else if (item.id) {
            node = {
              id: item.id.text,
              kind: item.kind.text,
              label: item.label && stringValue(item.label),
              props: {},
              parent: parent?.id,
              children: [],
              isContainer: false,
              span: item.span,
            };
            model.nodes.set(node.id, node);
            if (parent) {
              parent.children.push(node.id);
              parent.isContainer = true;
            } else model.roots.push(node.id);
          }
          // A node without a usable id is transparent: its children attach to the enclosing node.
          if (item.block) walk(item.block.items, node ?? parent, node ? new Map() : undefined);
          break;
        }
        case "Error":
          if (item.block) walk(item.block.items, parent, undefined);
          break;
      }
    }
  }

  walk(cst.items, undefined, undefined);
  for (const { edge, source, target } of endpoints)
    for (const end of [source, target])
      if (!model.nodes.has(end.text))
        diagnostics.push({
          severity: "error",
          code: "model/unknown-node",
          message: `Edge '${edge}' refers to unknown node '${end.text}'`,
          span: end.span,
        });
  return { model, diagnostics };
}

export interface ParseModelResult extends BuildResult {
  cst: FileNode;
}

/** Parse and build in one go; diagnostics are parse diagnostics followed by model diagnostics. */
export function parseModel(text: string): ParseModelResult {
  const parsed = parse(text);
  const built = buildModel(parsed.cst);
  return { cst: parsed.cst, model: built.model, diagnostics: [...parsed.diagnostics, ...built.diagnostics] };
}

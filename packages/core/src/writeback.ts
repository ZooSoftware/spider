// Structural write-back: canvas edits → minimal text edits on the current source.
// Each operation re-parses the given source, locates statements by span and returns
// TextEdits; everything not touched stays byte-identical (comments, order, formatting).
import { buildModel } from "./build.ts";
import type { BlockNode, EdgeStmt, FileNode, Item, NodeStmt } from "./cst.ts";
import { indentOf, lineBreakOf, lineSpan } from "./cst.ts";
import type { TextEdit } from "./edits.ts";
import type { Model, Span } from "./model.ts";
import { parse } from "./parser.ts";

type Container = FileNode | BlockNode;

interface Located {
  item: Item;
  container: Container;
}

interface Doc {
  source: string;
  cst: FileNode;
  model: Model;
  lb: string;
  /** Statement by span start. */
  byStart: Map<number, Located>;
}

function load(source: string): Doc {
  const { cst } = parse(source);
  const { model } = buildModel(cst);
  const byStart = new Map<number, Located>();
  const walk = (container: Container): void => {
    for (const item of container.items) {
      byStart.set(item.span.start, { item, container });
      if ((item.type === "Node" || item.type === "Error") && item.block) walk(item.block);
    }
  };
  walk(cst);
  return { source, cst, model, lb: lineBreakOf(source), byStart };
}

function nodeStmt(doc: Doc, id: string): Located & { item: NodeStmt } {
  const node = doc.model.nodes.get(id);
  const loc = node && doc.byStart.get(node.span.start);
  if (!loc || loc.item.type !== "Node") throw new Error(`unknown node "${id}"`);
  return loc as Located & { item: NodeStmt };
}

function edgeStmt(doc: Doc, id: string): Located & { item: EdgeStmt } {
  const edge = doc.model.edges.get(id);
  const loc = edge && doc.byStart.get(edge.span.start);
  if (!loc || loc.item.type !== "Edge") throw new Error(`unknown edge "${id}"`);
  return loc as Located & { item: EdgeStmt };
}

/**
 * Range removed when deleting a statement: its whole line(s). If that leaves two blank lines
 * next to each other (the statement was surrounded by blank lines), one goes too.
 */
function removalSpan(source: string, span: Span): Span & { ownLine: boolean } {
  const ls = lineSpan(source, span);
  if (!ls.ownLine) return ls;
  const blankBefore = ls.start === 0 || /(^|\n)[ \t]*\r?\n$/.test(source.slice(Math.max(0, ls.start - 200), ls.start));
  const next = /^[ \t]*(\r?\n|$)/.exec(source.slice(ls.end));
  if (blankBefore && next && ls.end < source.length) return { ...ls, end: ls.end + next[0].length };
  return ls;
}

export function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

const INDENT_UNIT = "  ";

/** Indentation for new statements directly inside `container`. */
function childIndent(doc: Doc, container: Container): string {
  for (const item of container.items) {
    const ind = indentOf(doc.source, item.span);
    if (ind !== undefined) return ind;
  }
  if (container.type === "File") return "";
  return (lineIndent(doc.source, container.open.span.start) ?? "") + INDENT_UNIT;
}

/** Indentation of the line containing `offset`. */
function lineIndent(source: string, offset: number): string {
  let i = offset;
  while (i > 0 && source[i - 1] !== "\n" && source[i - 1] !== "\r") i--;
  let j = i;
  while (source[j] === " " || source[j] === "\t") j++;
  return source.slice(i, j);
}

/** Insert `stmt` as a new statement after `anchor`, or at the start/end of `container`. */
function insertAfter(doc: Doc, container: Container, anchor: Item | undefined, stmt: string): TextEdit {
  const indent = childIndent(doc, container);
  const { source, lb } = doc;
  if (anchor) {
    const ls = lineSpan(source, anchor.span);
    if (ls.ownLine) {
      const atEof = ls.end === source.length && !/\r?\n$/.test(source.slice(0, ls.end));
      return atEof
        ? { span: { start: ls.end, end: ls.end }, newText: `${lb}${indent}${stmt}` }
        : { span: { start: ls.end, end: ls.end }, newText: `${indent}${stmt}${lb}` };
    }
    // Statement shares its line with others (`{ a x  b y }`): stay on that line.
    return { span: { start: anchor.span.end, end: anchor.span.end }, newText: `  ${stmt}` };
  }
  if (container.type === "File") {
    const end = source.length;
    const needsLb = end > 0 && !source.endsWith("\n");
    return { span: { start: end, end }, newText: `${needsLb ? lb : ""}${stmt}${lb}` };
  }
  // Empty block: `{}` or `{\n}`.
  const at = container.open.span.end;
  const closeIndent = lineIndent(source, container.open.span.start);
  const closeOnOwnLine = container.close !== undefined && indentOf(source, container.close.span) !== undefined;
  return {
    span: { start: at, end: at },
    newText: closeOnOwnLine ? `${lb}${indent}${stmt}` : `${lb}${indent}${stmt}${lb}${closeIndent}`,
  };
}

function lastOf(container: Container, pred: (i: Item) => boolean): Item | undefined {
  for (let i = container.items.length - 1; i >= 0; i--) if (pred(container.items[i]!)) return container.items[i];
  return undefined;
}

// ---- operations ----

export interface AddEdgeOptions {
  kind?: string;
  label?: string;
}

/** Append `source -> target [: kind] ["label"]` after the last top-level edge (or at the end). */
export function addEdge(source: string, from: string, to: string, opts: AddEdgeOptions = {}): TextEdit[] {
  const doc = load(source);
  const stmt = `${from} -> ${to}${opts.kind ? ` : ${opts.kind}` : ""}${opts.label ? ` ${quote(opts.label)}` : ""}`;
  const anchor = lastOf(doc.cst, (i) => i.type === "Edge") ?? lastOf(doc.cst, () => true);
  return [insertAfter(doc, doc.cst, anchor, stmt)];
}

export interface AddNodeOptions {
  kind: string;
  id?: string;
  label?: string;
  /** Container to add the node to; top level when omitted. */
  parent?: string;
}

/** Returns the edits and the id of the new node (generated from the kind when not given). */
export function addNode(source: string, opts: AddNodeOptions): { edits: TextEdit[]; id: string } {
  const doc = load(source);
  const id = opts.id ?? uniqueId(doc.model, opts.kind.replace(/^.*\./, ""));
  const stmt = `${opts.kind} ${id}${opts.label !== undefined ? ` ${quote(opts.label)}` : ""}`;
  if (opts.parent === undefined) {
    const anchor = lastOf(doc.cst, (i) => i.type === "Node") ?? lastOf(doc.cst, (i) => i.type === "Use");
    if (anchor) return { edits: [insertAfter(doc, doc.cst, anchor, stmt)], id };
    const lead = { span: { start: 0, end: 0 }, newText: `${stmt}${doc.lb}` };
    return { edits: [lead], id };
  }
  return { edits: insertIntoNode(doc, opts.parent, stmt), id };
}

export function uniqueId(model: Model, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=\d)/, "_") || "node";
  for (let n = 1; ; n++) {
    const id = `${clean}${n}`;
    if (!model.nodes.has(id)) return id;
  }
}

/** Insert a statement (possibly multi-line, already indented for depth 0) into a node's block. */
function insertIntoNode(doc: Doc, parentId: string, stmt: string): TextEdit[] {
  const parent = nodeStmt(doc, parentId);
  const { item } = parent;
  if (item.block) {
    const indent = childIndent(doc, item.block);
    const text = reindent(stmt, indent, doc.lb);
    const anchor = lastOf(item.block, (i) => i.type === "Node") ?? lastOf(item.block, () => true);
    const edit = insertAfter(doc, item.block, anchor, text);
    return [edit];
  }
  // Parent has no block yet: `zone z "Z"` → `zone z "Z" {\n  stmt\n}`.
  const base = indentOf(doc.source, item.span) ?? lineIndent(doc.source, item.span.start);
  const indent = base + INDENT_UNIT;
  const text = reindent(stmt, indent, doc.lb);
  return [{ span: { start: item.span.end, end: item.span.end }, newText: ` {${doc.lb}${indent}${text}${doc.lb}${base}}` }];
}

/** Re-indent continuation lines of `text` (first line is placed after `indent` by the caller). */
function reindent(text: string, indent: string, lb: string): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => (i === 0 || line === "" ? line : indent + line))
    .join(lb);
}

/** Text of a statement with continuation lines dedented by its own indentation. */
function dedentedText(doc: Doc, span: Span): string {
  const own = indentOf(doc.source, span) ?? lineIndent(doc.source, span.start);
  return doc.source
    .slice(span.start, span.end)
    .split(/\r?\n/)
    .map((line, i) => (i > 0 && line.startsWith(own) ? line.slice(own.length) : line))
    .join("\n");
}

export interface DeleteTargets {
  nodes?: string[];
  edges?: string[];
}

/** Delete nodes (with their whole block) and edges; edges touching deleted nodes go too. */
export function deleteElements(source: string, targets: DeleteTargets): TextEdit[] {
  const doc = load(source);
  const removedNodes = new Set<string>();
  const addSubtree = (id: string): void => {
    if (removedNodes.has(id)) return;
    removedNodes.add(id);
    for (const c of doc.model.nodes.get(id)?.children ?? []) addSubtree(c);
  };
  for (const id of targets.nodes ?? []) if (doc.model.nodes.has(id)) addSubtree(id);

  const spans: Span[] = [];
  for (const id of targets.nodes ?? []) if (doc.model.nodes.has(id)) spans.push(removalSpan(doc.source, nodeStmt(doc, id).item.span));
  for (const e of doc.model.edges.values()) {
    if (removedNodes.has(e.source) || removedNodes.has(e.target) || targets.edges?.includes(e.id)) {
      spans.push(removalSpan(doc.source, edgeStmt(doc, e.id).item.span));
    }
  }
  // Drop spans nested in others (e.g. an edge inside a deleted container's block).
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextEdit[] = [];
  let reach = -1;
  for (const s of spans) {
    if (s.start < reach) continue;
    out.push({ span: { start: s.start, end: s.end }, newText: "" });
    reach = s.end;
  }
  return out;
}

export type LabelTarget = { node: string } | { edge: string };

/** Set (or remove, with an empty label) the label of a node or edge. */
export function setLabel(source: string, target: LabelTarget, label: string): TextEdit[] {
  const doc = load(source);
  let existing: { span: Span } | undefined;
  let after: { span: Span } | undefined;
  if ("node" in target) {
    const { item } = nodeStmt(doc, target.node);
    existing = item.label;
    after = item.id;
  } else {
    const { item } = edgeStmt(doc, target.edge);
    existing = item.label;
    after = item.edgeKind ?? item.target;
  }
  if (existing) {
    if (label !== "") return [{ span: existing.span, newText: quote(label) }];
    let start = existing.span.start;
    while (start > 0 && (doc.source[start - 1] === " " || doc.source[start - 1] === "\t")) start--;
    return [{ span: { start, end: existing.span.end }, newText: "" }];
  }
  if (label === "" || !after) return [];
  return [{ span: { start: after.span.end, end: after.span.end }, newText: ` ${quote(label)}` }];
}

/** Move a node (with its block) into another container, or to the top level. */
export function moveNode(source: string, id: string, newParent: string | undefined): TextEdit[] {
  const doc = load(source);
  const node = doc.model.nodes.get(id);
  if (!node) throw new Error(`unknown node "${id}"`);
  if (node.parent === newParent) return [];
  for (let p = newParent; p !== undefined; p = doc.model.nodes.get(p)?.parent) {
    if (p === id) throw new Error(`cannot move "${id}" into itself`);
  }
  const { item } = nodeStmt(doc, id);
  const removed = removalSpan(doc.source, item.span);
  // Carry a same-line trailing comment along with the statement.
  const line = lineSpan(doc.source, item.span);
  const textEnd = line.ownLine ? line.end - (doc.source.slice(0, line.end).match(/\r?\n$/)?.[0].length ?? 0) : item.span.end;
  const text = dedentedText(doc, { start: item.span.start, end: textEnd });
  const remove: TextEdit = { span: removed, newText: "" };
  let insert: TextEdit[];
  if (newParent === undefined) {
    const anchor = lastOf(doc.cst, (i) => i.type === "Node" && i !== item) ?? lastOf(doc.cst, (i) => i.type === "Use");
    insert = [anchor ? insertAfter(doc, doc.cst, anchor, reindent(text, "", doc.lb)) : { span: { start: 0, end: 0 }, newText: `${text}${doc.lb}` }];
  } else {
    insert = insertIntoNode(doc, newParent, text);
  }
  // The insertion point may sit at the edge of (or inside) the removed range when the moved
  // node was the anchor; shift such insertions to the end of the removed range.
  return [remove, ...insert.map((e) => (e.span.start > remove.span.start && e.span.start < remove.span.end ? { ...e, span: { start: remove.span.end, end: remove.span.end } } : e))];
}

/** True if `id` is a valid node id (same rule as the lexer's identifiers, minus keywords). */
export function isValidId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && id !== "use" && id !== "as" && id !== "true" && id !== "false";
}

/**
 * Rename a node id everywhere it is used: its declaration and every edge end. Throws if the
 * new id is invalid or already taken.
 */
export function renameId(source: string, from: string, to: string): TextEdit[] {
  if (from === to) return [];
  if (!isValidId(to)) throw new Error(`"${to}" is not a valid id`);
  const doc = load(source);
  if (doc.model.nodes.has(to)) throw new Error(`id "${to}" is already used`);
  const { item } = nodeStmt(doc, from);
  const edits: TextEdit[] = [];
  if (item.id) edits.push({ span: item.id.span, newText: to });
  for (const e of doc.model.edges.values()) {
    const { item: stmt } = edgeStmt(doc, e.id);
    if (e.source === from) edits.push({ span: stmt.source.span, newText: to });
    if (e.target === from && stmt.target) edits.push({ span: stmt.target.span, newText: to });
  }
  return edits;
}

/** Edge id after renaming node `from` to `to` (edge ids are derived from their ends). */
export function renameEdgeId(edgeId: string, from: string, to: string): string {
  const m = /^(.*)->(.*?)(#\d+)?$/.exec(edgeId);
  if (!m) return edgeId;
  const [, s, t, n] = m;
  return `${s === from ? to : s}->${t === from ? to : t}${n ?? ""}`;
}

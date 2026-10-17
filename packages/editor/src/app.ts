// Editor app: state, history and wiring. Keeps code and canvas in sync.
//  code → canvas: the engine pipeline (parse, profile, layout, validation) runs as you type.
//  canvas → layout: drag / resize / line edits / unpin / reset only touch the layout sidecar
//                   (commands.ts).
//  canvas → code: connect, delete, rename, add from palette and move into/out of containers
//                 become targeted text edits applied through the code editor.
//  history: one undo/redo stack of { text, layout } snapshots, one step per user action.
// Other modules: canvas (gestures), code (CodeMirror), overlay (handles), io (server),
// inline-input, palette, panels, zoom, export.
import {
  addEdge,
  addNode,
  deleteElements,
  isValidId,
  moveNode,
  renameId,
  setLabel,
  type Diagnostic,
  type Model,
  type TextEdit,
} from "@spider/core";
import { analyze, layoutDiagnostics } from "@spider/engine";
import { emptyLayout, parseLayoutFile, serializeLayoutFile, type EdgeLayout, type LayoutFile, type NodeLayout } from "@spider/layout";
import { renderSvg } from "@spider/render";
import { Canvas, type Point, type Target } from "./canvas.ts";
import { createCodeEditor } from "./code.ts";
import {
  containerAt,
  dragEnd,
  dragSegment,
  dropRedundantMin,
  droppedNodeBox,
  edgeSnapshot,
  hasCustomRoute,
  isContainer,
  moveNodes,
  nextEdgeId,
  relayout,
  renameInLayout,
  resetRoute as resetRouteOf,
  resizeNode,
  subtree,
  unpin as unpinNodes,
  type Scene,
} from "./commands.ts";
import { exportPng, exportSvg } from "./export.ts";
import { History } from "./history.ts";
import { openInlineInput } from "./inline-input.ts";
import { fetchDoc, ServerIO, type ProfileCache } from "./io.ts";
import { overlay } from "./overlay.ts";
import { renderPalette } from "./palette.ts";
import { setupSplit } from "./panels.ts";
import { setupZoom, zoomKey } from "./zoom.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const state = {
  model: undefined as Model | undefined,
  profile: undefined as ProfileCache | undefined,
  layout: emptyLayout(),
  /** Parse + profile + validation diagnostics; layout warnings are added on top. */
  baseDiagnostics: [] as Diagnostic[],
  diagnostics: [] as Diagnostic[],
  selected: undefined as Target | undefined,
  /** Container highlighted as drop target while dragging a node. */
  dropTarget: undefined as string | undefined,
  /** Connection being drawn from a node's connect handle. */
  connect: undefined as { from: string; pointer: Point; over: string | undefined } | undefined,
  /** Node to open the label editor for once it exists (after adding from the palette). */
  pendingRename: undefined as string | undefined,
  /** Positions of nodes that disappeared from the code this session (e.g. an id mid-edit). */
  memory: new Map<string, NodeLayout>(),
  generation: 0,
  /** Record a history step when the next recompile finishes (after a code change). */
  commitPending: false,
  /** An undo/redo is being applied; its recompile hasn't settled yet. */
  restoring: false,
};

/** Model + profile + layout, once the first compile has finished. */
function scene(): Scene | undefined {
  return state.model && state.profile ? { model: state.model, profile: state.profile.profile, layout: state.layout } : undefined;
}

const io = new ServerIO(() => status());

// ---- history ----

interface Snapshot {
  text: string;
  layout: string;
  selected: Target | undefined;
}

const sameContent = (a: Snapshot, b: Snapshot): boolean => a.text === b.text && a.layout === b.layout;
const history = new History<Snapshot>(sameContent);
// `?debug` exposes internals for troubleshooting from the browser console.
if (new URLSearchParams(location.search).has("debug")) Object.assign(globalThis, { __spider: { history, state, io } });

function snapshot(): Snapshot {
  return { text: code.text(), layout: serializeLayoutFile(state.layout, state.model), selected: state.selected };
}

/** Record the current state as one step (no-op if nothing changed). */
function commit(): void {
  if (!state.model) return;
  history.commit(snapshot());
  historyButtons();
}

let typingTimer: ReturnType<typeof setTimeout> | undefined;

/** A burst of typing becomes one step once the user pauses. */
function commitTypingSoon(): void {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingTimer = undefined;
    state.commitPending = true;
    void recompile(code.text());
  }, 800);
}

/** Make sure un-committed work (e.g. typing just now) is a step before moving in history. */
function flush(): void {
  clearTimeout(typingTimer);
  typingTimer = undefined;
  if (state.restoring) return;
  const cur = history.current;
  if (state.model && cur && !sameContent(cur, snapshot())) commit();
}

function restore(s: Snapshot | undefined): void {
  if (!s) return;
  state.commitPending = false;
  state.layout = parseLayoutFile(s.layout).layout;
  state.selected = s.selected;
  code.setText(s.text);
  saveTextSoon(s.text);
  state.restoring = true;
  // The recompile re-routes edges and re-orders entries: store the settled state as this step.
  void recompile(s.text).then(() => {
    state.restoring = false;
    history.replace(snapshot());
  });
  historyButtons();
}

function undoAction(): void {
  flush();
  restore(history.undo());
}

function redoAction(): void {
  flush();
  restore(history.redo());
}

function historyButtons(): void {
  $<HTMLButtonElement>("undo").disabled = !history.canUndo;
  $<HTMLButtonElement>("redo").disabled = !history.canRedo;
}

// ---- saving ----

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const saveTextSoon = debounce((text: string) => void io.putText(text), 400);
const saveLayoutSoon = debounce(() => {
  if (state.model) void io.putLayout(serializeLayoutFile(state.layout, state.model));
}, 400);

// ---- code → canvas ----

/** The layout to keep: the current one plus remembered positions, or only pinned nodes on reset. */
function previousLayout(model: Model, reset: boolean): LayoutFile {
  if (reset) {
    const pinned = Object.entries(state.layout.nodes).filter(([, n]) => n.pinned);
    return { version: 1, nodes: Object.fromEntries(pinned), edges: {} };
  }
  const previous = { ...state.layout, nodes: { ...state.layout.nodes } };
  for (const id of model.nodes.keys()) {
    const remembered = state.memory.get(id);
    if (!previous.nodes[id] && remembered) previous.nodes[id] = remembered;
  }
  return previous;
}

async function recompile(text: string, opts: { reset?: "unpinned" } = {}): Promise<void> {
  const gen = ++state.generation;
  const result = await analyze(text, (uses) => io.profile(uses, state.profile), {
    previous: (model) => previousLayout(model, !!opts.reset),
  });
  if (gen !== state.generation) return;
  const { model, layout } = result;
  const cache = result.loaded.cache;

  for (const [id, n] of Object.entries(state.layout.nodes)) if (!layout.nodes[id]) state.memory.set(id, n);
  for (const id of model.nodes.keys()) state.memory.delete(id);

  const profileChanged = state.profile?.key !== cache.key;
  state.model = model;
  state.profile = cache;
  state.layout = layout;
  const sel = state.selected;
  if (sel && !(sel.type === "node" ? model.nodes.has(sel.id) : model.edges.has(sel.id))) state.selected = undefined;
  state.baseDiagnostics = result.diagnostics;
  refreshDiagnostics();
  if (profileChanged) renderPalette($("palette"), Object.values(cache.profile.nodes));
  draw();
  status();
  saveLayoutSoon();

  if (state.commitPending) {
    state.commitPending = false;
    commit();
  }

  if (state.pendingRename && model.nodes.has(state.pendingRename)) {
    const id = state.pendingRename;
    state.pendingRename = undefined;
    openRename({ type: "node", id });
  }
}

/** Layout-dependent warnings (container overlaps) change on every drag, not only on recompile. */
function refreshDiagnostics(): void {
  const s = scene();
  if (!s) return;
  state.diagnostics = [...state.baseDiagnostics, ...layoutDiagnostics(s)];
  code.setDiagnostics(state.diagnostics);
  status();
}

const recompileSoon = debounce((text: string) => void recompile(text), 150);

/** Apply write-back edits computed from the current code text. */
function edit(make: (text: string) => TextEdit[], userEvent: string): boolean {
  try {
    const edits = make(code.text());
    code.apply(edits, userEvent);
    return edits.length > 0;
  } catch (err) {
    console.warn("[spider] edit failed:", err);
    return false;
  }
}

// ---- drawing ----

let frame = 0;
function drawSoon(): void {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
}

function draw(): void {
  const s = scene();
  if (!s) return;
  const svg = renderSvg(s.model, s.profile, s.layout, { interactive: true });
  canvas.show(svg.replace(/<\/svg>\s*$/, `${overlay(s, state)}</svg>`));
}

function status(): void {
  const errors = state.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = state.diagnostics.filter((d) => d.severity === "warning").length;
  const counts = [errors ? `<span class="err">${errors} error${errors > 1 ? "s" : ""}</span>` : "", warnings ? `<span class="warn">${warnings} warning${warnings > 1 ? "s" : ""}</span>` : ""]
    .filter(Boolean)
    .join(" · ");
  $("status").innerHTML = `${counts || "no problems"} · ${io.saving ? "saving…" : "saved"}`;
  const unpin = $<HTMLButtonElement>("unpin");
  const selNode = state.selected?.type === "node" ? state.selected.id : undefined;
  const anyPinned = Object.values(state.layout.nodes).some((n) => n.pinned);
  unpin.textContent = selNode ? "Unpin" : "Unpin all";
  unpin.disabled = selNode ? !state.layout.nodes[selNode]?.pinned : !anyPinned;
  const selEdge = state.selected?.type === "edge" ? state.layout.edges[state.selected.id] : undefined;
  const reset = $<HTMLButtonElement>("reset-route");
  reset.hidden = !selEdge;
  reset.disabled = !hasCustomRoute(selEdge);
}

// ---- canvas → layout / code ----

function select(t: Target | undefined): void {
  state.selected = t;
  status();
  drawSoon();
}

/** Boxes at the start of a node drag or resize. */
let drag: { ids: string[]; exclude: Set<string>; orig: Map<string, NodeLayout> } | undefined;
/** The line's layout at the start of a line drag. */
let edgeDrag: { id: string; orig: EdgeLayout } | undefined;

function endEdgeDrag(): void {
  edgeDrag = undefined;
  saveLayoutSoon();
  commit();
  status();
}

/** The line's layout at drag start (taken on the first move of a line drag). */
function edgeDragStart(id: string): EdgeLayout | undefined {
  const e = state.layout.edges[id];
  if (!e) return undefined;
  edgeDrag ??= { id, orig: edgeSnapshot(e) };
  return edgeDrag.orig;
}

/** Back to automatic routing for the selected line (drops manual points and ports). */
function resetRoute(): void {
  const sel = state.selected;
  const s = scene();
  if (sel?.type !== "edge" || !s || !resetRouteOf(s, sel.id)) return;
  saveLayoutSoon();
  commit();
  draw();
  status();
}

const canvas = new Canvas($("canvas"), {
  onNodeDown(id) {
    select({ type: "node", id });
    const ids = state.model ? subtree(state.model, id).filter((i) => state.layout.nodes[i]) : [];
    drag = { ids, exclude: new Set(ids), orig: new Map(ids.map((i) => [i, { ...state.layout.nodes[i]! }])) };
  },
  onNodeDrag(_id, dx, dy, pointer) {
    const s = scene();
    if (!drag || !s) return;
    moveNodes(s.layout, drag.orig, dx, dy);
    // Containers keep their size while dragging so a node can be dragged out of one.
    relayout(s, false);
    state.dropTarget = containerAt(s, pointer, drag.exclude);
    drawSoon();
  },
  onNodeUp(id, moved, pointer) {
    const exclude = drag?.exclude ?? new Set([id]);
    drag = undefined;
    state.dropTarget = undefined;
    if (!moved) {
      const span = state.model?.nodes.get(id)?.span;
      if (span) code.reveal(span);
      drawSoon();
      return;
    }
    const s = scene();
    if (!s) return;
    const n = s.layout.nodes[id];
    if (n) n.pinned = true;
    const target = containerAt(s, pointer, exclude);
    const parent = s.model.nodes.get(id)?.parent;
    // Dropped into another container (or out to the top level): membership is code.
    if (target !== parent && edit((text) => moveNode(text, id, target), "move.spider")) return;
    relayout(s);
    refreshDiagnostics();
    saveLayoutSoon();
    commit();
    drawSoon();
  },
  onResize(id, dx, dy, done) {
    const s = scene();
    const n = state.layout.nodes[id];
    if (!s || !n) return;
    drag ??= { ids: [id], exclude: new Set([id]), orig: new Map([[id, { ...n }]]) };
    resizeNode(s, id, drag.orig.get(id)!, dx, dy);
    relayout(s);
    drawSoon();
    if (done) {
      drag = undefined;
      dropRedundantMin(s, id);
      refreshDiagnostics();
      saveLayoutSoon();
      commit();
    }
  },
  onSegmentDrag(id, k, pointer, done) {
    const s = scene();
    const orig = edgeDragStart(id);
    if (!s || !orig) return;
    dragSegment(s, id, orig, k, pointer);
    if (done) endEdgeDrag();
    drawSoon();
  },
  onEndDrag(id, end, pointer, done) {
    const s = scene();
    const orig = edgeDragStart(id);
    if (!s || !orig) return;
    dragEnd(s, id, orig, end, pointer);
    if (done) endEdgeDrag();
    drawSoon();
  },
  onEdgeDown(id) {
    select({ type: "edge", id });
    const span = state.model?.edges.get(id)?.span;
    if (span) code.reveal(span);
  },
  onConnect(from, pointer, over, done) {
    state.connect = done ? undefined : { from, pointer, over };
    if (done && over && over !== from && state.model) {
      const next = nextEdgeId(state.model, from, over);
      if (edit((text) => addEdge(text, from, over), "input.spider.connect")) state.selected = { type: "edge", id: next };
    }
    drawSoon();
  },
  onDoubleClick(target) {
    // Next tick: the canvas takes focus on this same pointerdown, which would blur the input.
    setTimeout(() => openRename(target), 0);
  },
  onDropKind(kind, p) {
    const s = scene();
    if (!s) return;
    const parent = containerAt(s, p);
    let id: string | undefined;
    const ok = edit((text) => {
      const r = addNode(text, { kind, label: `New ${kind.replace(/^.*\./, "")}`, parent });
      id = r.id;
      return r.edits;
    }, "input.spider.add");
    if (!ok || !id) return;
    state.layout.nodes[id] = droppedNodeBox(s.profile, kind, p);
    state.selected = { type: "node", id };
    state.pendingRename = id;
  },
  onBackground() {
    select(undefined);
  },
});

// ---- inline label / id editors ----

/** Screen rect of a node (a container's title bar). */
function nodeScreenRect(id: string): { x: number; y: number; w: number; h: number } | undefined {
  const n = state.layout.nodes[id];
  if (!n || !state.model) return undefined;
  return canvas.toScreenRect(isContainer(state.model, id) ? { x: n.x, y: n.y, w: n.w, h: 36 } : n);
}

function openRename(target: Target): void {
  const model = state.model;
  if (!model) return;
  let rect: { x: number; y: number; w: number; h: number } | undefined;
  let value: string;
  if (target.type === "node") {
    value = model.nodes.get(target.id)?.label ?? "";
    rect = nodeScreenRect(target.id);
  } else {
    value = model.edges.get(target.id)?.label ?? "";
    const el = state.layout.edges[target.id];
    const pts = el?.points ?? [];
    const [x, y] = el?.labelPos ?? pts[Math.floor(pts.length / 2)] ?? [0, 0];
    rect = canvas.toScreenRect({ x: x - 70, y: y - 14, w: 140, h: 28 });
  }
  if (!rect) return;
  openInlineInput($("canvas"), {
    rect,
    value,
    placeholder: target.type === "edge" ? "edge label" : "label",
    onCommit(label) {
      const t = target.type === "node" ? { node: target.id } : { edge: target.id };
      edit((text) => setLabel(text, t, label), "input.spider.rename");
    },
  });
}

/** Inline editor for a node's id: renames it in the code and re-keys its layout entries. */
function openRenameId(id: string): void {
  const rect = nodeScreenRect(id);
  if (!rect || !state.model?.nodes.has(id)) return;
  openInlineInput($("canvas"), {
    rect,
    value: id,
    title: "Node id (letters, digits, _)",
    mono: true,
    valid: (v) => v === id || (isValidId(v) && !state.model?.nodes.has(v)),
    onCommit(to) {
      // Re-key the layout first so the renamed node keeps its place and its lines keep their routes.
      const before = state.layout;
      state.layout = renameInLayout(state.layout, id, to);
      if (edit((text) => renameId(text, id, to), "input.spider.rename-id")) state.selected = { type: "node", id: to };
      else state.layout = before;
    },
  });
}

function unpin(): void {
  unpinNodes(state.layout, state.selected?.type === "node" ? state.selected.id : undefined);
  saveLayoutSoon();
  draw();
  status();
  commit();
}

function deleteSelection(): void {
  const sel = state.selected;
  if (!sel) return;
  const targets = sel.type === "node" ? { nodes: [sel.id] } : { edges: [sel.id] };
  if (edit((text) => deleteElements(text, targets), "delete.spider")) select(undefined);
}

// ---- boot ----

const doc = await fetchDoc();
$("file").textContent = doc.name;
document.title = `${doc.name} · spider`;
io.savedText = doc.text;
if (doc.layout) {
  state.layout = parseLayoutFile(doc.layout).layout;
  io.savedLayout = doc.layout;
}

const code = createCodeEditor($("code"), doc.text, {
  onChange(text, fromCanvas) {
    recompileSoon(text);
    saveTextSoon(text);
    if (fromCanvas) state.commitPending = true;
    else commitTypingSoon();
  },
  onUndo: undoAction,
  onRedo: redoAction,
});

setupSplit(document.querySelector<HTMLElement>(".split")!, $("divider"));
setupZoom(canvas, $("zoom"));
$("unpin").addEventListener("click", unpin);
$("reset-route").addEventListener("click", resetRoute);
/** The diagram as it would be exported (no selection, handles or hit areas). */
const cleanSvg = (): string | undefined => {
  const s = scene();
  return s && renderSvg(s.model, s.profile, s.layout);
};
const baseName = doc.name.replace(/\.spd$/, "");
$("export-svg").addEventListener("click", () => {
  const svg = cleanSvg();
  if (svg) exportSvg(svg, baseName);
});
$("export-png").addEventListener("click", () => {
  const svg = cleanSvg();
  if (svg) void exportPng(svg, baseName).catch((err: unknown) => console.warn("[spider] PNG export failed:", err));
});
$("reset").addEventListener("click", () => {
  state.commitPending = true;
  void recompile(code.text(), { reset: "unpinned" });
});
$("undo").addEventListener("click", undoAction);
$("redo").addEventListener("click", redoAction);
const canvasEl = $("canvas");
// The palette floats inside the canvas: its presses must not start a pan, its wheel must scroll it.
for (const type of ["pointerdown", "wheel"] as const) $("palette").addEventListener(type, (e) => e.stopPropagation());
canvasEl.addEventListener("pointerdown", () => canvasEl.focus());
canvasEl.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    (e.shiftKey ? redoAction : undoAction)();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redoAction();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteSelection();
  } else if (e.key === "F2" && state.selected) openRename(state.selected);
  else if (e.key === "f") canvas.fit();
  else if (!mod && zoomKey(canvas, e.key)) e.preventDefault();
  else if (e.key === "u") unpin();
  else if (e.key === "r") resetRoute();
  else if (e.key === "i" && state.selected?.type === "node") {
    e.preventDefault();
    openRenameId(state.selected.id);
  }
  else if (e.key === "Escape") select(undefined);
});

io.listen({
  text(text) {
    code.setText(text);
    state.commitPending = true;
    void recompile(text);
  },
  layout(layout) {
    state.layout = layout ? parseLayoutFile(layout).layout : emptyLayout();
    state.commitPending = true;
    void recompile(code.text());
  },
});

const hint = document.createElement("div");
hint.className = "hint";
hint.textContent =
  "drag: move/pin · drop on a box: move inside · ⊕ handle: connect · line: drag its handles · R: reset route · double-click/F2: rename · I: rename id · Del: delete · Ctrl+Z: undo · +/−/0: zoom · F: fit";
canvasEl.appendChild(hint);

await recompile(doc.text);
history.reset(snapshot());
historyButtons();

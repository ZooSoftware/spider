// Editor app: keeps code and canvas in sync.
//  code → canvas: parse, validate, incremental layout, render (debounced as you type).
//  canvas → layout: drag / resize / unpin / reset only touch the layout sidecar.
//  canvas → code: connect, delete, rename, add from palette and move into/out of containers
//  become targeted text edits applied through the code editor.
//  history: one undo/redo stack of { text, layout } snapshots, one step per user action.
import {
  addEdge,
  addNode,
  deleteElements,
  edgeId,
  moveNode,
  parseModel,
  setLabel,
  type Diagnostic,
  type Model,
  type TextEdit,
  type UseDecl,
} from "@spider/core";
import { DEFAULT_NODE_SIZE, type ResolvedProfile } from "@spider/profile-schema";
import { validate } from "@spider/profiles/validate";
import {
  containerOverlapDiagnostics,
  containerOverlaps,
  emptyLayout,
  fitContainers,
  layoutDiagram,
  parseLayoutFile,
  routeEdges,
  serializeLayoutFile,
  type LayoutFile,
  type NodeLayout,
} from "@spider/layout";
import { renderSvg } from "@spider/render/render";
import { Canvas, PALETTE_MIME, type Point, type Target } from "./canvas.ts";
import { createCodeEditor } from "./code.ts";
import { History } from "./history.ts";
import { setupSplit } from "./panels.ts";
import { setupZoom, zoomKey } from "./zoom.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface ProfileCache {
  key: string;
  profile: ResolvedProfile;
  diagnostics: Diagnostic[];
  uses: UseDecl[];
}

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
  savedLayout: "",
  savedText: "",
  generation: 0,
  saving: 0,
  /** Record a history step when the next recompile finishes (after a code change). */
  commitPending: false,
  /** An undo/redo is being applied; its recompile hasn't settled yet. */
  restoring: false,
};

// ---- history ----

interface Snapshot {
  text: string;
  layout: string;
  selected: Target | undefined;
}

const sameContent = (a: Snapshot, b: Snapshot): boolean => a.text === b.text && a.layout === b.layout;
const history = new History<Snapshot>(sameContent);

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

// ---- server IO ----

async function putText(text: string): Promise<void> {
  if (text === state.savedText) return;
  state.savedText = text;
  await track(fetch("/api/text", { method: "PUT", body: text }));
}

async function putLayout(): Promise<void> {
  if (!state.model) return;
  const json = serializeLayoutFile(state.layout, state.model);
  if (json === state.savedLayout) return;
  state.savedLayout = json;
  await track(fetch("/api/layout", { method: "PUT", body: json }));
}

async function track(p: Promise<Response>): Promise<void> {
  state.saving++;
  status();
  try {
    await p;
  } finally {
    state.saving--;
    status();
  }
}

async function profileFor(uses: UseDecl[]): Promise<ProfileCache> {
  const key = JSON.stringify(uses.map((u) => [u.profile, u.version, u.alias]));
  if (state.profile?.key === key) return state.profile;
  const res = await fetch("/api/profile", { method: "POST", body: JSON.stringify(uses) });
  const { profile, diagnostics } = (await res.json()) as { profile: ResolvedProfile; diagnostics: Diagnostic[] };
  return { key, profile, diagnostics, uses };
}

/** Profile diagnostics point at `use` spans from when they were loaded; move them to the current spans. */
function remapProfileDiagnostics(cache: ProfileCache, uses: UseDecl[]): Diagnostic[] {
  return cache.diagnostics.map((d) => {
    const i = cache.uses.findIndex((u) => u.span.start === d.span?.start && u.span.end === d.span?.end);
    const span = i >= 0 ? uses[i]?.span : undefined;
    return span ? { ...d, span } : d;
  });
}

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const saveTextSoon = debounce((text: string) => void putText(text), 400);
const saveLayoutSoon = debounce(() => void putLayout(), 400);

// ---- code → canvas ----

async function recompile(text: string, opts: { reset?: "unpinned" } = {}): Promise<void> {
  const gen = ++state.generation;
  const { model, diagnostics } = parseModel(text);
  const cache = await profileFor(model.uses);
  if (gen !== state.generation) return;

  let previous: LayoutFile;
  if (opts.reset) {
    const pinned = Object.entries(state.layout.nodes).filter(([, n]) => n.pinned);
    previous = { version: 1, nodes: Object.fromEntries(pinned), edges: {} };
  } else {
    previous = { ...state.layout, nodes: { ...state.layout.nodes } };
    for (const id of model.nodes.keys()) {
      const remembered = state.memory.get(id);
      if (!previous.nodes[id] && remembered) previous.nodes[id] = remembered;
    }
  }
  const layout = await layoutDiagram(model, cache.profile, previous);
  if (gen !== state.generation) return;

  for (const [id, n] of Object.entries(state.layout.nodes)) if (!layout.nodes[id]) state.memory.set(id, n);
  for (const id of model.nodes.keys()) state.memory.delete(id);

  const profileChanged = state.profile?.key !== cache.key;
  state.model = model;
  state.profile = cache;
  state.layout = layout;
  const sel = state.selected;
  if (sel && !(sel.type === "node" ? model.nodes.has(sel.id) : model.edges.has(sel.id))) state.selected = undefined;
  state.baseDiagnostics = [...diagnostics, ...remapProfileDiagnostics(cache, model.uses), ...validate(model, cache.profile)];
  refreshDiagnostics();
  if (profileChanged) renderPalette();
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
  if (!state.model || !state.profile) return;
  state.diagnostics = [...state.baseDiagnostics, ...containerOverlapDiagnostics(state.model, state.profile.profile, state.layout.nodes)];
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
  if (!state.model || !state.profile) return;
  const svg = renderSvg(state.model, state.profile.profile, state.layout, { interactive: true });
  canvas.show(svg.replace(/<\/svg>\s*$/, `${overlay()}</svg>`));
}

const box = (n: NodeLayout, pad: number, cls: string): string =>
  `<rect class="${cls}" x="${n.x - pad}" y="${n.y - pad}" width="${n.w + 2 * pad}" height="${n.h + 2 * pad}" rx="6"/>`;

function overlay(): string {
  const parts: string[] = [];
  const nodes = state.layout.nodes;
  for (const n of Object.values(nodes)) {
    if (n.pinned) parts.push(`<circle class="spd-pin" cx="${n.x + n.w - 1}" cy="${n.y + 1}" r="3.5"><title>pinned</title></circle>`);
  }
  if (state.model && state.profile) {
    for (const { node, container } of containerOverlaps(state.model, state.profile.profile, nodes)) {
      const n = nodes[node];
      if (n) parts.push(box(n, 5, "spd-warn").replace("/>", `><title>Overlaps "${container}" but is not inside it: drag it out, or into it</title></rect>`));
    }
  }
  const drop = state.dropTarget ? nodes[state.dropTarget] : undefined;
  if (drop) parts.push(box(drop, 3, "spd-drop"));
  const sel = state.selected;
  if (sel?.type === "edge") {
    const pts = state.layout.edges[sel.id]?.points ?? [];
    if (pts.length) parts.push(`<polyline class="spd-sel-edge" points="${pts.map((p) => p.join(",")).join(" ")}"/>`);
  } else if (sel?.type === "node" && nodes[sel.id]) {
    const n = nodes[sel.id]!;
    parts.push(box(n, 4, "spd-sel"));
    parts.push(`<rect class="spd-handle" data-id="${sel.id}" x="${n.x + n.w - 1}" y="${n.y + n.h - 1}" width="9" height="9" rx="2"/>`);
    if (!state.connect) {
      parts.push(
        `<g class="spd-connect" data-id="${sel.id}"><title>drag to connect</title><circle cx="${n.x + n.w + 14}" cy="${n.y + n.h / 2}" r="7"/><path d="M${n.x + n.w + 10} ${n.y + n.h / 2}h8M${n.x + n.w + 14} ${n.y + n.h / 2 - 4}v8"/></g>`,
      );
    }
  }
  const c = state.connect;
  if (c && nodes[c.from]) {
    const s = nodes[c.from]!;
    if (c.over && c.over !== c.from && nodes[c.over]) parts.push(box(nodes[c.over]!, 3, "spd-drop"));
    parts.push(`<line class="spd-preview" x1="${s.x + s.w / 2}" y1="${s.y + s.h / 2}" x2="${c.pointer.x}" y2="${c.pointer.y}"/>`);
  }
  return `<g class="spd-overlay">${parts.join("")}</g>`;
}

function status(): void {
  const errors = state.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = state.diagnostics.filter((d) => d.severity === "warning").length;
  const counts = [errors ? `<span class="err">${errors} error${errors > 1 ? "s" : ""}</span>` : "", warnings ? `<span class="warn">${warnings} warning${warnings > 1 ? "s" : ""}</span>` : ""]
    .filter(Boolean)
    .join(" · ");
  $("status").innerHTML = `${counts || "no problems"} · ${state.saving ? "saving…" : "saved"}`;
  const unpin = $<HTMLButtonElement>("unpin");
  const selNode = state.selected?.type === "node" ? state.selected.id : undefined;
  const anyPinned = Object.values(state.layout.nodes).some((n) => n.pinned);
  unpin.textContent = selNode ? "Unpin" : "Unpin all";
  unpin.disabled = selNode ? !state.layout.nodes[selNode]?.pinned : !anyPinned;
}

// ---- palette ----

function renderPalette(): void {
  const el = $("palette");
  const kinds = Object.values(state.profile?.profile.nodes ?? {});
  el.hidden = kinds.length === 0;
  el.innerHTML = `<div class="pal-title">Drag to add</div>`;
  for (const k of kinds) {
    const item = document.createElement("div");
    item.className = "pal-item";
    item.draggable = true;
    item.title = k.description ?? k.kind;
    item.innerHTML = `<span class="pal-icon">${k.iconSvg ?? ""}</span><span>${k.kind}</span>`;
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(PALETTE_MIME, k.kind);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });
    el.appendChild(item);
  }
}

// ---- canvas → layout / code ----

function isContainer(id: string): boolean {
  const n = state.model?.nodes.get(id);
  return !!n && (n.isContainer || n.children.length > 0);
}

/** Containers (or container kinds) can receive dropped nodes. */
function acceptsChildren(id: string): boolean {
  const n = state.model?.nodes.get(id);
  return !!n && (isContainer(id) || state.profile?.profile.nodes[n.kind]?.container === true);
}

function subtree(id: string): string[] {
  const out = [id];
  for (const c of state.model?.nodes.get(id)?.children ?? []) out.push(...subtree(c));
  return out;
}

/** Innermost container whose box contains `p`, ignoring `exclude`. */
function containerAt(p: Point, exclude: Set<string> = new Set()): string | undefined {
  let best: string | undefined;
  let bestArea = Infinity;
  for (const [id, n] of Object.entries(state.layout.nodes)) {
    if (exclude.has(id) || !acceptsChildren(id)) continue;
    if (p.x < n.x || p.x > n.x + n.w || p.y < n.y || p.y > n.y + n.h) continue;
    if (n.w * n.h < bestArea) {
      best = id;
      bestArea = n.w * n.h;
    }
  }
  return best;
}

function relayoutGeometry(fit = true): void {
  if (!state.model || !state.profile) return;
  if (fit) fitContainers(state.model, state.profile.profile, state.layout.nodes);
  state.layout.edges = routeEdges(state.model, state.profile.profile, state.layout.nodes, state.layout.edges);
}

function select(t: Target | undefined): void {
  state.selected = t;
  status();
  drawSoon();
}

let drag: { ids: string[]; exclude: Set<string>; orig: Map<string, NodeLayout> } | undefined;

const canvas = new Canvas($("canvas"), {
  onNodeDown(id) {
    select({ type: "node", id });
    const ids = subtree(id).filter((i) => state.layout.nodes[i]);
    drag = { ids, exclude: new Set(ids), orig: new Map(ids.map((i) => [i, { ...state.layout.nodes[i]! }])) };
  },
  onNodeDrag(_id, dx, dy, pointer) {
    if (!drag) return;
    for (const i of drag.ids) {
      const o = drag.orig.get(i)!;
      state.layout.nodes[i] = { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
    }
    // Containers keep their size while dragging so a node can be dragged out of one.
    relayoutGeometry(false);
    state.dropTarget = containerAt(pointer, drag.exclude);
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
    const n = state.layout.nodes[id];
    if (n) n.pinned = true;
    const target = containerAt(pointer, exclude);
    const parent = state.model?.nodes.get(id)?.parent;
    // Dropped into another container (or out to the top level): membership is code.
    if (target !== parent && edit((text) => moveNode(text, id, target), "move.spider")) return;
    relayoutGeometry();
    refreshDiagnostics();
    saveLayoutSoon();
    commit();
    drawSoon();
  },
  onResize(id, dx, dy, done) {
    const n = state.layout.nodes[id];
    if (!n) return;
    drag ??= { ids: [id], exclude: new Set([id]), orig: new Map([[id, { ...n }]]) };
    const o = drag.orig.get(id)!;
    const w = Math.max(40, Math.round(o.w + dx));
    const h = Math.max(30, Math.round(o.h + dy));
    if (isContainer(id)) {
      // Containers fit their children: the handle sets a minimum size, never below the content.
      state.layout.nodes[id] = { ...o, minW: w, minH: h, pinned: true };
    } else {
      state.layout.nodes[id] = { ...o, w, h, pinned: true };
    }
    relayoutGeometry();
    drawSoon();
    if (done) {
      drag = undefined;
      const c = state.layout.nodes[id]!;
      // Dragged back down to (or below) the content: no minimum left to remember.
      if (isContainer(id) && c.minW !== undefined && c.minH !== undefined) {
        const fit = { ...c, minW: undefined, minH: undefined };
        const probe = { ...state.layout.nodes, [id]: fit };
        if (state.model && state.profile) fitContainers(state.model, state.profile.profile, probe);
        if (c.minW <= probe[id]!.w) delete c.minW;
        if (c.minH <= probe[id]!.h) delete c.minH;
      }
      refreshDiagnostics();
      saveLayoutSoon();
      commit();
    }
  },
  onEdgeDown(id) {
    select({ type: "edge", id });
    const span = state.model?.edges.get(id)?.span;
    if (span) code.reveal(span);
  },
  onConnect(from, pointer, over, done) {
    state.connect = done ? undefined : { from, pointer, over };
    if (done && over && over !== from && state.model) {
      const ordinal = [...state.model.edges.values()].filter((e) => e.source === from && e.target === over).length + 1;
      if (edit((text) => addEdge(text, from, over), "input.spider.connect")) state.selected = { type: "edge", id: edgeId(from, over, ordinal) };
    }
    drawSoon();
  },
  onDoubleClick(target) {
    // Next tick: the canvas takes focus on this same pointerdown, which would blur the input.
    setTimeout(() => openRename(target), 0);
  },
  onDropKind(kind, p) {
    const parent = containerAt(p);
    const def = state.profile?.profile.nodes[kind];
    const [w, h] = def?.size ?? DEFAULT_NODE_SIZE;
    let id: string | undefined;
    const ok = edit((text) => {
      const r = addNode(text, { kind, label: `New ${kind.replace(/^.*\./, "")}`, parent });
      id = r.id;
      return r.edits;
    }, "input.spider.add");
    if (!ok || !id) return;
    state.layout.nodes[id] = { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, pinned: true };
    state.selected = { type: "node", id };
    state.pendingRename = id;
  },
  onBackground() {
    select(undefined);
  },
});

// ---- inline label editor ----

function openRename(target: Target): void {
  const model = state.model;
  if (!model) return;
  let current: string | undefined;
  let rect: { x: number; y: number; w: number; h: number } | undefined;
  if (target.type === "node") {
    current = model.nodes.get(target.id)?.label ?? "";
    const n = state.layout.nodes[target.id];
    if (n) rect = canvas.toScreenRect(isContainer(target.id) ? { x: n.x, y: n.y, w: n.w, h: 36 } : n);
  } else {
    current = model.edges.get(target.id)?.label ?? "";
    const el = state.layout.edges[target.id];
    const pts = el?.points ?? [];
    const [x, y] = el?.labelPos ?? pts[Math.floor(pts.length / 2)] ?? [0, 0];
    rect = canvas.toScreenRect({ x: x - 70, y: y - 14, w: 140, h: 28 });
  }
  if (!rect) return;
  document.querySelector(".rename")?.remove();
  const input = document.createElement("input");
  input.className = "rename";
  input.value = current;
  input.placeholder = target.type === "edge" ? "edge label" : "label";
  const w = Math.max(rect.w, 140);
  Object.assign(input.style, { left: `${rect.x + rect.w / 2 - w / 2}px`, top: `${rect.y + rect.h / 2 - 15}px`, width: `${w}px` });
  $("canvas").appendChild(input);
  input.focus();
  input.select();
  let closed = false;
  const close = (commit: boolean): void => {
    if (closed) return;
    closed = true;
    input.remove();
    $("canvas").focus();
    if (commit && input.value !== current) {
      const t = target.type === "node" ? { node: target.id } : { edge: target.id };
      edit((text) => setLabel(text, t, input.value), "input.spider.rename");
    }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") close(true);
    else if (e.key === "Escape") close(false);
  });
  input.addEventListener("blur", () => close(true));
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function unpin(): void {
  const selNode = state.selected?.type === "node" ? state.selected.id : undefined;
  const ids = selNode ? [selNode] : Object.keys(state.layout.nodes);
  for (const id of ids) {
    const n = state.layout.nodes[id];
    if (n) delete n.pinned;
  }
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

const doc = (await (await fetch("/api/doc")).json()) as { name: string; text: string; layout: string | null };
$("file").textContent = doc.name;
document.title = `${doc.name} · spider`;
state.savedText = doc.text;
if (doc.layout) {
  state.layout = parseLayoutFile(doc.layout).layout;
  state.savedLayout = doc.layout;
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
  else if (e.key === "Escape") select(undefined);
});

const events = new EventSource("/api/events");
events.addEventListener("text", (e) => {
  const { text } = JSON.parse((e as MessageEvent<string>).data) as { text: string };
  state.savedText = text;
  code.setText(text);
  state.commitPending = true;
  void recompile(text);
});
events.addEventListener("layout", (e) => {
  const { layout } = JSON.parse((e as MessageEvent<string>).data) as { layout: string };
  state.savedLayout = layout;
  state.layout = layout ? parseLayoutFile(layout).layout : emptyLayout();
  state.commitPending = true;
  void recompile(code.text());
});

const hint = document.createElement("div");
hint.className = "hint";
hint.textContent =
  "drag: move/pin · drop on a box: move inside · ⊕ handle: connect · double-click/F2: rename · Del: delete · Ctrl+Z: undo · +/−/0: zoom · F: fit";
canvasEl.appendChild(hint);

await recompile(doc.text);
history.reset(snapshot());
historyButtons();

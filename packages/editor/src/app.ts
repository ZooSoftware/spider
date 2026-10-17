// Editor app: keeps code and canvas in sync.
//  code → canvas: parse, validate, incremental layout, render (debounced as you type).
//  canvas → layout: drag / resize / unpin / reset only touch the layout sidecar, never the code.
import { parseModel, type Diagnostic, type Model, type UseDecl } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import { validate } from "@spider/profiles/validate";
import {
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
import { Canvas } from "./canvas.ts";
import { createCodeEditor } from "./code.ts";

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
  diagnostics: [] as Diagnostic[],
  selected: undefined as string | undefined,
  /** Positions of nodes that disappeared from the code this session (e.g. an id mid-edit). */
  memory: new Map<string, NodeLayout>(),
  savedLayout: "",
  savedText: "",
  generation: 0,
  saving: 0,
};

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

  state.model = model;
  state.profile = cache;
  state.layout = layout;
  if (state.selected && !model.nodes.has(state.selected)) select(undefined);
  state.diagnostics = [...diagnostics, ...remapProfileDiagnostics(cache, model.uses), ...validate(model, cache.profile)];
  code.setDiagnostics(state.diagnostics);
  draw();
  status();
  saveLayoutSoon();
}

const recompileSoon = debounce((text: string) => void recompile(text), 150);

// ---- drawing ----

let frame = 0;
function drawSoon(): void {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function draw(): void {
  if (!state.model || !state.profile) return;
  const svg = renderSvg(state.model, state.profile.profile, state.layout);
  canvas.show(svg.replace(/<\/svg>\s*$/, `${overlay()}</svg>`));
}

function overlay(): string {
  const parts: string[] = [];
  for (const [id, n] of Object.entries(state.layout.nodes)) {
    if (n.pinned) parts.push(`<circle class="spd-pin" cx="${n.x + n.w - 1}" cy="${n.y + 1}" r="3.5"><title>pinned</title></circle>`);
    if (id !== state.selected) continue;
    parts.push(`<rect class="spd-sel" x="${n.x - 4}" y="${n.y - 4}" width="${n.w + 8}" height="${n.h + 8}" rx="6"/>`);
    if (!isContainer(id)) parts.push(`<rect class="spd-handle" data-id="${id}" x="${n.x + n.w - 1}" y="${n.y + n.h - 1}" width="9" height="9" rx="2"/>`);
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
  const anyPinned = Object.values(state.layout.nodes).some((n) => n.pinned);
  unpin.textContent = state.selected ? "Unpin" : "Unpin all";
  unpin.disabled = state.selected ? !state.layout.nodes[state.selected]?.pinned : !anyPinned;
}

// ---- canvas → layout ----

function isContainer(id: string): boolean {
  const n = state.model?.nodes.get(id);
  return !!n && (n.isContainer || n.children.length > 0);
}

function subtree(id: string): string[] {
  const out = [id];
  for (const c of state.model?.nodes.get(id)?.children ?? []) out.push(...subtree(c));
  return out;
}

function relayoutGeometry(): void {
  if (!state.model || !state.profile) return;
  fitContainers(state.model, state.profile.profile, state.layout.nodes);
  state.layout.edges = routeEdges(state.model, state.profile.profile, state.layout.nodes, state.layout.edges);
}

function select(id: string | undefined): void {
  state.selected = id;
  status();
}

let drag: { ids: string[]; orig: Map<string, NodeLayout> } | undefined;

const canvas = new Canvas($("canvas"), {
  onNodeDown(id) {
    select(id);
    const ids = subtree(id).filter((i) => state.layout.nodes[i]);
    drag = { ids, orig: new Map(ids.map((i) => [i, { ...state.layout.nodes[i]! }])) };
    drawSoon();
  },
  onNodeDrag(_id, dx, dy) {
    if (!drag) return;
    for (const i of drag.ids) {
      const o = drag.orig.get(i)!;
      state.layout.nodes[i] = { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
    }
    relayoutGeometry();
    drawSoon();
  },
  onNodeUp(id, moved) {
    drag = undefined;
    if (moved) {
      const n = state.layout.nodes[id];
      if (n) n.pinned = true;
      saveLayoutSoon();
    } else {
      const span = state.model?.nodes.get(id)?.span;
      if (span) code.reveal(span);
    }
    drawSoon();
    status();
  },
  onResize(id, dx, dy, done) {
    const n = state.layout.nodes[id];
    if (!n) return;
    drag ??= { ids: [id], orig: new Map([[id, { ...n }]]) };
    const o = drag.orig.get(id)!;
    state.layout.nodes[id] = { ...o, w: Math.max(40, Math.round(o.w + dx)), h: Math.max(30, Math.round(o.h + dy)), pinned: true };
    relayoutGeometry();
    drawSoon();
    if (done) {
      drag = undefined;
      saveLayoutSoon();
    }
  },
  onBackground() {
    select(undefined);
    drawSoon();
  },
});

function unpin(): void {
  const ids = state.selected ? [state.selected] : Object.keys(state.layout.nodes);
  for (const id of ids) {
    const n = state.layout.nodes[id];
    if (n) delete n.pinned;
  }
  saveLayoutSoon();
  draw();
  status();
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

const code = createCodeEditor($("code"), doc.text, (text) => {
  recompileSoon(text);
  saveTextSoon(text);
});

$("fit").addEventListener("click", () => canvas.fit());
$("unpin").addEventListener("click", unpin);
$("reset").addEventListener("click", () => void recompile(code.text(), { reset: "unpinned" }));
$("canvas").addEventListener("keydown", (e) => {
  if (e.key === "f") canvas.fit();
  else if (e.key === "u") unpin();
  else if (e.key === "Escape") {
    select(undefined);
    draw();
  }
});

const events = new EventSource("/api/events");
events.addEventListener("text", (e) => {
  const { text } = JSON.parse((e as MessageEvent<string>).data) as { text: string };
  state.savedText = text;
  code.setText(text);
  void recompile(text);
});
events.addEventListener("layout", (e) => {
  const { layout } = JSON.parse((e as MessageEvent<string>).data) as { layout: string };
  state.savedLayout = layout;
  state.layout = layout ? parseLayoutFile(layout).layout : emptyLayout();
  void recompile(code.text());
});

const hint = document.createElement("div");
hint.className = "hint";
hint.textContent = "drag nodes to pin · drag background to pan · wheel to zoom · F fit · U unpin";
$("canvas").appendChild(hint);

await recompile(doc.text);

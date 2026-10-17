// Canvas pane: shows the rendered SVG, owns the camera (pan/zoom via viewBox) and turns pointer
// input into gestures in diagram coordinates: select, drag/resize nodes, connect, rename, drop.

export interface Point {
  x: number;
  y: number;
}

export type Target = { type: "node"; id: string } | { type: "edge"; id: string };

export interface CanvasHandlers {
  onNodeDown(id: string): void;
  onNodeDrag(id: string, dx: number, dy: number, pointer: Point): void;
  onNodeUp(id: string, moved: boolean, pointer: Point): void;
  onResize(id: string, dx: number, dy: number, done: boolean): void;
  onEdgeDown(id: string): void;
  /** Dragging from a node's connect handle; `over` is the node under the pointer. */
  onConnect(from: string, pointer: Point, over: string | undefined, done: boolean): void;
  onDoubleClick(target: Target): void;
  /** A palette kind dropped on the canvas. */
  onDropKind(kind: string, pointer: Point): void;
  onBackground(): void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DRAG_THRESHOLD = 3;
export const PALETTE_MIME = "application/x-spider-kind";

/** Camera: diagram point at the center of the stage, and pixels per diagram unit. */
interface Camera {
  cx: number;
  cy: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export class Canvas {
  private camera: Camera | undefined;
  private content: Box = { x: 0, y: 0, w: 100, h: 100 };
  private svg: SVGSVGElement | undefined;
  private readonly stage: HTMLElement;
  /** Last primary press, for double-click detection (the SVG is re-rendered between clicks,
   *  so the native dblclick event, which needs the same element twice, never fires). */
  private lastPress: { key: string; time: number; x: number; y: number } | undefined;
  /** Called whenever the zoom level changes (for the zoom control). */
  onZoom: (zoom: number) => void = () => {};

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: CanvasHandlers,
  ) {
    this.stage = document.createElement("div");
    this.stage.className = "stage";
    el.prepend(this.stage);
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    el.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes(PALETTE_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    el.addEventListener("drop", (e) => {
      const kind = e.dataTransfer?.getData(PALETTE_MIME);
      if (!kind) return;
      e.preventDefault();
      handlers.onDropKind(kind, this.toDiagram(e.clientX, e.clientY));
    });
    // Panel resizes change the stage size; keep the same center and zoom.
    new ResizeObserver(() => this.apply()).observe(this.stage);
  }

  show(svgMarkup: string): void {
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svgMarkup);
    if (vb) this.content = { x: +vb[1]!, y: +vb[2]!, w: +vb[3]!, h: +vb[4]! };
    const first = this.camera === undefined;
    this.stage.innerHTML = svgMarkup;
    this.svg = this.stage.querySelector("svg") ?? undefined;
    this.svg?.removeAttribute("width");
    this.svg?.removeAttribute("height");
    if (first) this.fit();
    else this.apply();
  }

  get zoom(): number {
    return this.camera?.zoom ?? 1;
  }

  fit(): void {
    const pad = 24;
    const c = this.content;
    const { w, h } = this.stageSize();
    const zoom = clampZoom(Math.min(w / (c.w + 2 * pad), h / (c.h + 2 * pad)));
    this.camera = { cx: c.x + c.w / 2, cy: c.y + c.h / 2, zoom };
    this.apply();
  }

  /** Set the zoom level, keeping the diagram point under `anchor` (default: center) in place. */
  setZoom(zoom: number, anchor?: Point): void {
    const c = this.camera;
    if (!c) return;
    const z = clampZoom(zoom);
    const a = anchor ?? { x: c.cx, y: c.cy };
    const k = c.zoom / z;
    this.camera = { cx: a.x - (a.x - c.cx) * k, cy: a.y - (a.y - c.cy) * k, zoom: z };
    this.apply();
  }

  private stageSize(): { w: number; h: number } {
    return { w: Math.max(1, this.stage.clientWidth), h: Math.max(1, this.stage.clientHeight) };
  }

  private apply(): void {
    const c = this.camera;
    if (!this.svg || !c) return;
    const { w, h } = this.stageSize();
    const vw = w / c.zoom;
    const vh = h / c.zoom;
    this.svg.setAttribute("viewBox", `${c.cx - vw / 2} ${c.cy - vh / 2} ${vw} ${vh}`);
    this.onZoom(c.zoom);
  }

  /** Screen → diagram coordinates. */
  toDiagram(clientX: number, clientY: number): Point {
    const ctm = this.svg?.getScreenCTM();
    if (!this.svg || !ctm) return { x: clientX, y: clientY };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /** Diagram box → screen rect relative to the canvas element. */
  toScreenRect(b: Box): Box {
    const ctm = this.svg?.getScreenCTM();
    const host = this.el.getBoundingClientRect();
    if (!ctm) return b;
    const p = new DOMPoint(b.x, b.y).matrixTransform(ctm);
    return { x: p.x - host.left, y: p.y - host.top, w: b.w * ctm.a, h: b.h * ctm.d };
  }

  private targetAt(t: EventTarget | null): Target | undefined {
    const el = t instanceof Element ? t : null;
    const edge = el?.closest<SVGElement>(".spd-edge, .spd-edge-label");
    if (edge?.dataset.id) return { type: "edge", id: edge.dataset.id };
    const node = el?.closest<SVGElement>(".spd-node");
    if (node?.dataset.id) return { type: "node", id: node.dataset.id };
    return undefined;
  }

  private nodeUnder(clientX: number, clientY: number): string | undefined {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const node = el.closest<SVGElement>(".spd-node");
      if (node?.dataset.id) return node.dataset.id;
    }
    return undefined;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.camera) return;
    // Gentle steps: ~10% per mouse-wheel notch, smoother for trackpad pinch (ctrl+wheel).
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.006 : 0.001));
    this.setZoom(this.camera.zoom * factor, this.toDiagram(e.clientX, e.clientY));
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    const el = e.target instanceof Element ? e.target : null;
    const handle = el?.closest<SVGElement>(".spd-handle");
    const connect = el?.closest<SVGElement>(".spd-connect");
    const target = this.targetAt(e.target);
    if (e.button === 0 && target) {
      const key = `${target.type}:${target.id}`;
      const last = this.lastPress;
      const now = performance.now();
      this.lastPress = { key, time: now, x: e.clientX, y: e.clientY };
      if (last && last.key === key && now - last.time < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) {
        this.lastPress = undefined;
        e.preventDefault();
        this.handlers.onDoubleClick(target);
        return;
      }
    }
    const start = this.toDiagram(e.clientX, e.clientY);
    const startScreen = { x: e.clientX, y: e.clientY };
    let moved = false;
    this.el.setPointerCapture(e.pointerId);

    let move: (ev: PointerEvent) => void;
    let up: (ev: PointerEvent) => void;

    if (e.button === 0 && connect?.dataset.id) {
      const from = connect.dataset.id;
      const at = (ev: PointerEvent, done: boolean): void =>
        this.handlers.onConnect(from, this.toDiagram(ev.clientX, ev.clientY), this.nodeUnder(ev.clientX, ev.clientY), done);
      move = (ev) => at(ev, false);
      up = (ev) => at(ev, true);
    } else if (e.button === 0 && handle?.dataset.id) {
      const id = handle.dataset.id;
      const at = (ev: PointerEvent, done: boolean): void => {
        const p = this.toDiagram(ev.clientX, ev.clientY);
        this.handlers.onResize(id, p.x - start.x, p.y - start.y, done);
      };
      move = (ev) => at(ev, false);
      up = (ev) => at(ev, true);
    } else if (e.button === 0 && target?.type === "edge") {
      this.handlers.onEdgeDown(target.id);
      move = () => {};
      up = () => {};
    } else if (e.button === 0 && target?.type === "node" && !e.shiftKey) {
      const id = target.id;
      this.handlers.onNodeDown(id);
      this.el.classList.add("dragging");
      move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < DRAG_THRESHOLD) return;
        moved = true;
        const p = this.toDiagram(ev.clientX, ev.clientY);
        this.handlers.onNodeDrag(id, p.x - start.x, p.y - start.y, p);
      };
      up = (ev) => {
        this.el.classList.remove("dragging");
        this.handlers.onNodeUp(id, moved, this.toDiagram(ev.clientX, ev.clientY));
      };
    } else {
      // Pan: keep the grabbed diagram point under the cursor.
      const cam0 = this.camera ? { ...this.camera } : undefined;
      this.el.classList.add("panning");
      move = (ev) => {
        if (!cam0) return;
        if (Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) >= DRAG_THRESHOLD) moved = true;
        this.camera = { ...cam0, cx: cam0.cx - (ev.clientX - startScreen.x) / cam0.zoom, cy: cam0.cy - (ev.clientY - startScreen.y) / cam0.zoom };
        this.apply();
      };
      up = () => {
        this.el.classList.remove("panning");
        if (!moved) this.handlers.onBackground();
      };
    }

    const onMove = (ev: PointerEvent): void => move(ev);
    const onUp = (ev: PointerEvent): void => {
      this.el.removeEventListener("pointermove", onMove);
      this.el.removeEventListener("pointerup", onUp);
      this.el.removeEventListener("pointercancel", onUp);
      up(ev);
    };
    this.el.addEventListener("pointermove", onMove);
    this.el.addEventListener("pointerup", onUp);
    this.el.addEventListener("pointercancel", onUp);
  }
}

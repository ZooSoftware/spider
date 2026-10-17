// Canvas pane: shows the rendered SVG, owns the camera (pan/zoom via viewBox) and turns pointer
// input into node drag / resize / select gestures in diagram coordinates.

export interface CanvasHandlers {
  /** Pointer down on a node; return false to ignore the gesture. */
  onNodeDown(id: string): void;
  onNodeDrag(id: string, dx: number, dy: number): void;
  onNodeUp(id: string, moved: boolean): void;
  onResize(id: string, dx: number, dy: number, done: boolean): void;
  onBackground(): void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DRAG_THRESHOLD = 3;

export class Canvas {
  private camera: Box | undefined;
  private content: Box = { x: 0, y: 0, w: 100, h: 100 };
  private svg: SVGSVGElement | undefined;
  private readonly stage: HTMLElement;

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: CanvasHandlers,
  ) {
    this.stage = document.createElement("div");
    this.stage.className = "stage";
    el.prepend(this.stage);
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
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

  fit(): void {
    const pad = 24;
    const c = this.content;
    this.camera = { x: c.x - pad, y: c.y - pad, w: c.w + 2 * pad, h: c.h + 2 * pad };
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    if (this.svg && c) this.svg.setAttribute("viewBox", `${c.x} ${c.y} ${c.w} ${c.h}`);
  }

  /** Screen → diagram coordinates. */
  private toDiagram(clientX: number, clientY: number): { x: number; y: number } {
    const ctm = this.svg?.getScreenCTM();
    if (!this.svg || !ctm) return { x: clientX, y: clientY };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const c = this.camera;
    if (!c) return;
    const p = this.toDiagram(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const w = Math.min(Math.max(c.w * factor, 50), 50000);
    const k = w / c.w;
    this.camera = { x: p.x - (p.x - c.x) * k, y: p.y - (p.y - c.y) * k, w, h: c.h * k };
    this.apply();
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target instanceof Element ? e.target : null;
    const handle = target?.closest<SVGElement>(".spd-handle");
    const node = target?.closest<SVGElement>(".spd-node");
    const start = this.toDiagram(e.clientX, e.clientY);
    const startScreen = { x: e.clientX, y: e.clientY };
    let moved = false;
    this.el.setPointerCapture(e.pointerId);

    let move: (ev: PointerEvent) => void;
    let up: (ev: PointerEvent) => void;

    if (e.button === 0 && handle?.dataset.id) {
      const id = handle.dataset.id;
      move = (ev) => {
        const p = this.toDiagram(ev.clientX, ev.clientY);
        this.handlers.onResize(id, p.x - start.x, p.y - start.y, false);
      };
      up = (ev) => {
        const p = this.toDiagram(ev.clientX, ev.clientY);
        this.handlers.onResize(id, p.x - start.x, p.y - start.y, true);
      };
    } else if (e.button === 0 && node?.dataset.id && !e.shiftKey) {
      const id = node.dataset.id;
      this.handlers.onNodeDown(id);
      this.el.classList.add("dragging");
      move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < DRAG_THRESHOLD) return;
        moved = true;
        const p = this.toDiagram(ev.clientX, ev.clientY);
        this.handlers.onNodeDrag(id, p.x - start.x, p.y - start.y);
      };
      up = () => {
        this.el.classList.remove("dragging");
        this.handlers.onNodeUp(id, moved);
      };
    } else {
      // Pan: keep the grabbed diagram point under the cursor.
      const cam0 = this.camera ? { ...this.camera } : undefined;
      const ctm = this.svg?.getScreenCTM();
      const scale = ctm ? 1 / ctm.a : 1;
      this.el.classList.add("panning");
      move = (ev) => {
        if (!cam0) return;
        if (Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) >= DRAG_THRESHOLD) moved = true;
        this.camera = { ...cam0, x: cam0.x - (ev.clientX - startScreen.x) * scale, y: cam0.y - (ev.clientY - startScreen.y) * scale };
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

// Zoom control (slider on a log scale, −/+, 100%, Fit), kept in sync with wheel zoom.
import { MAX_ZOOM, MIN_ZOOM, type Canvas } from "./canvas.ts";

const STEP = 1.25;
const SLIDER_MAX = 1000;
const toSlider = (z: number): number => (Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * SLIDER_MAX;
const fromSlider = (v: number): number => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / SLIDER_MAX);

export function setupZoom(canvas: Canvas, root: HTMLElement): void {
  const q = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const slider = q<HTMLInputElement>("zoom-slider");
  const pct = q<HTMLButtonElement>("zoom-pct");

  canvas.onZoom = (z) => {
    slider.value = String(Math.round(toSlider(z)));
    pct.textContent = `${Math.round(z * 100)}%`;
  };
  slider.addEventListener("input", () => canvas.setZoom(fromSlider(Number(slider.value))));
  q("zoom-in").addEventListener("click", () => canvas.setZoom(canvas.zoom * STEP));
  q("zoom-out").addEventListener("click", () => canvas.setZoom(canvas.zoom / STEP));
  pct.addEventListener("click", () => canvas.setZoom(1));
  q("zoom-fit").addEventListener("click", () => canvas.fit());
  // Floating over the canvas: don't let presses pan or the wheel zoom the diagram.
  for (const type of ["pointerdown", "wheel", "dblclick"] as const) root.addEventListener(type, (e) => e.stopPropagation());
}

export function zoomKey(canvas: Canvas, key: string): boolean {
  if (key === "+" || key === "=") canvas.setZoom(canvas.zoom * STEP);
  else if (key === "-" || key === "_") canvas.setZoom(canvas.zoom / STEP);
  else if (key === "0") canvas.setZoom(1);
  else return false;
  return true;
}

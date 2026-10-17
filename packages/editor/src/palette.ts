// Palette of the profile's node kinds, floating in the canvas: drag one onto the canvas to add it.
import type { ResolvedNodeKind } from "@spider/profile-schema";
import { PALETTE_MIME } from "./canvas.ts";

export function renderPalette(el: HTMLElement, kinds: ResolvedNodeKind[]): void {
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

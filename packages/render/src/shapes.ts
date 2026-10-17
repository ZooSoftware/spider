// Node shape outlines as SVG markup. Each shape fills its box exactly so edge endpoints
// computed by the router (on the box boundary) visually touch the shape.
import type { Shape } from "@spider/profile-schema";
import { n } from "./svg.ts";

export interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
}

/**
 * Moves an edge endpoint lying on the box boundary onto the actual shape outline, along the
 * direction of its (axis-aligned) last segment. Box-like shapes are returned unchanged.
 */
export function snapToOutline(shape: Shape | undefined, box: { x: number; y: number; w: number; h: number }, p: [number, number]): [number, number] {
  const { x, y, w, h } = box;
  const r = x + w;
  const b = y + h;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const [px, py] = p;
  const eps = 0.5;
  const onLeft = Math.abs(px - x) < eps;
  const onRight = Math.abs(px - r) < eps;
  const onTop = Math.abs(py - y) < eps;
  const onBottom = Math.abs(py - b) < eps;
  const clampY = Math.min(b, Math.max(y, py));
  const clampX = Math.min(r, Math.max(x, px));
  switch (shape) {
    case "diamond": {
      if (onLeft || onRight) {
        const hw = (w / 2) * (1 - Math.abs(clampY - cy) / (h / 2));
        return [onLeft ? cx - hw : cx + hw, py];
      }
      if (onTop || onBottom) {
        const hh = (h / 2) * (1 - Math.abs(clampX - cx) / (w / 2));
        return [px, onTop ? cy - hh : cy + hh];
      }
      return p;
    }
    case "circle": {
      if (onLeft || onRight) {
        const t = (clampY - cy) / (h / 2);
        const hw = (w / 2) * Math.sqrt(Math.max(0, 1 - t * t));
        return [onLeft ? cx - hw : cx + hw, py];
      }
      if (onTop || onBottom) {
        const t = (clampX - cx) / (w / 2);
        const hh = (h / 2) * Math.sqrt(Math.max(0, 1 - t * t));
        return [px, onTop ? cy - hh : cy + hh];
      }
      return p;
    }
    case "hexagon": {
      const d = Math.min(18, w / 5);
      const inset = d * (Math.abs(clampY - cy) / (h / 2));
      if (onLeft) return [x + inset, py];
      if (onRight) return [r - inset, py];
      return p;
    }
    case "parallelogram": {
      const d = Math.min(16, w / 6);
      if (onLeft) return [x + (d * (b - clampY)) / h, py];
      if (onRight) return [r - (d * (clampY - y)) / h, py];
      return p;
    }
    default:
      return p;
  }
}

export function shapeSvg(shape: Shape | undefined, x: number, y: number, w: number, h: number, p: Paint): string {
  const attrs = `fill="${p.fill}" stroke="${p.stroke}" stroke-width="${n(p.strokeWidth)}"${p.dashed ? ' stroke-dasharray="6 4"' : ""}`;
  const r = x + w;
  const b = y + h;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (shape) {
    case "rect":
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" ${attrs}/>`;
    case "circle":
      return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${attrs}/>`;
    case "cylinder": {
      const ry = Math.min(10, h / 6);
      return (
        `<path d="M${n(x)} ${n(y + ry)} A${n(w / 2)} ${n(ry)} 0 0 1 ${n(r)} ${n(y + ry)} V${n(b - ry)} A${n(w / 2)} ${n(ry)} 0 0 1 ${n(x)} ${n(b - ry)} Z" ${attrs}/>` +
        `<path d="M${n(x)} ${n(y + ry)} A${n(w / 2)} ${n(ry)} 0 0 0 ${n(r)} ${n(y + ry)}" fill="none" stroke="${p.stroke}" stroke-width="${n(p.strokeWidth)}"/>`
      );
    }
    case "hexagon": {
      const d = Math.min(18, w / 5);
      return `<path d="M${n(x + d)} ${n(y)} H${n(r - d)} L${n(r)} ${n(cy)} L${n(r - d)} ${n(b)} H${n(x + d)} L${n(x)} ${n(cy)} Z" ${attrs}/>`;
    }
    case "diamond":
      return `<path d="M${n(cx)} ${n(y)} L${n(r)} ${n(cy)} L${n(cx)} ${n(b)} L${n(x)} ${n(cy)} Z" ${attrs}/>`;
    case "parallelogram": {
      const d = Math.min(16, w / 6);
      return `<path d="M${n(x + d)} ${n(y)} H${n(r)} L${n(r - d)} ${n(b)} H${n(x)} Z" ${attrs}/>`;
    }
    case "queue": {
      const rx = Math.min(10, w / 8);
      return (
        `<path d="M${n(x + rx)} ${n(y)} H${n(r - rx)} A${n(rx)} ${n(h / 2)} 0 0 1 ${n(r - rx)} ${n(b)} H${n(x + rx)} A${n(rx)} ${n(h / 2)} 0 0 1 ${n(x + rx)} ${n(y)} Z" ${attrs}/>` +
        `<path d="M${n(r - rx)} ${n(y)} A${n(rx)} ${n(h / 2)} 0 0 0 ${n(r - rx)} ${n(b)}" fill="none" stroke="${p.stroke}" stroke-width="${n(p.strokeWidth)}"/>`
      );
    }
    case "cloud": {
      // Bumpy outline inscribed in the box.
      const k = (fx: number, fy: number): string => `${n(x + fx * w)} ${n(y + fy * h)}`;
      return `<path d="M${k(0.2, 0.92)} C${k(0.02, 0.92)} ${k(0, 0.6)} ${k(0.16, 0.52)} C${k(0.08, 0.2)} ${k(0.38, 0.08)} ${k(0.48, 0.24)} C${k(0.56, 0)} ${k(0.88, 0.06)} ${k(0.86, 0.36)} C${k(1, 0.42)} ${k(1, 0.92)} ${k(0.82, 0.92)} Z" ${attrs}/>`;
    }
    case "person": {
      const head = Math.min(w, h) * 0.2;
      return (
        `<circle cx="${n(cx)}" cy="${n(y + head + 2)}" r="${n(head)}" ${attrs}/>` +
        `<path d="M${n(x + w * 0.12)} ${n(b)} V${n(y + h * 0.72)} C${n(x + w * 0.12)} ${n(y + h * 0.5)} ${n(r - w * 0.12)} ${n(y + h * 0.5)} ${n(r - w * 0.12)} ${n(y + h * 0.72)} V${n(b)} Z" ${attrs}/>`
      );
    }
    default: // "rounded" and unknown
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8" ${attrs}/>`;
  }
}

// Small SVG/text helpers: escaping, number formatting, text measurement and wrapping, icon embedding.

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Rough text width without a DOM: average glyph width ≈ 0.56em, wide glyphs count more. */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += /[MWmw@%]/.test(ch) ? 0.85 : /[ilIj.,:;|' ]/.test(ch) ? 0.3 : /[^\x00-\x7f]/.test(ch) ? 0.9 : 0.56;
  return units * fontSize;
}

/** Greedy word wrap to `maxWidth`, at most `maxLines` (last line ellipsized). */
export function wrap(text: string, fontSize: number, maxWidth: number, maxLines = 3): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, fontSize) > maxWidth) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

/** Embed a (sanitized) icon SVG as a nested <svg> at a given box, recolored via currentColor. */
export function embedIcon(iconSvg: string, x: number, y: number, size: number, color: string): string {
  const open = /<svg\b([^>]*)>/i.exec(iconSvg);
  const close = iconSvg.lastIndexOf("</svg>");
  if (!open || close < 0) return "";
  const attrs = open[1] ?? "";
  const viewBox = /viewBox\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "0 0 24 24";
  const keep = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]
    .map((a) => new RegExp(`\\s${a}\\s*=\\s*"([^"]*)"`, "i").exec(attrs))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[0])
    .join("");
  const inner = iconSvg.slice(open.index + open[0].length, close);
  return `<svg x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" viewBox="${esc(viewBox)}" color="${esc(color)}"${keep}>${inner}</svg>`;
}

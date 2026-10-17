// Human-readable diagnostics: `file:line:col severity code: message` plus a source excerpt.
import type { Diagnostic } from "@spider/core";

const COLORS = { error: "\x1b[31m", warning: "\x1b[33m", info: "\x1b[36m" } as const;
const RESET = "\x1b[0m";

export function lineCol(text: string, offset: number): { line: number; col: number; lineStart: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1, lineStart };
}

export function formatDiagnostic(d: Diagnostic, text: string, file: string, color = process.stderr.isTTY ?? false): string {
  const sev = color ? `${COLORS[d.severity]}${d.severity}${RESET}` : d.severity;
  if (!d.span) return `${file}: ${sev} ${d.code}: ${d.message}`;
  const { line, col, lineStart } = lineCol(text, d.span.start);
  const lineEnd = text.indexOf("\n", lineStart);
  const src = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).replace(/\r$/, "");
  const width = Math.max(1, Math.min(d.span.end, lineStart + src.length) - d.span.start);
  const gutter = String(line).length;
  return [
    `${file}:${line}:${col} ${sev} ${d.code}: ${d.message}`,
    `  ${String(line)} | ${src}`,
    `  ${" ".repeat(gutter)} | ${" ".repeat(col - 1)}${"^".repeat(width)}`,
  ].join("\n");
}

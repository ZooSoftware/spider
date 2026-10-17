// Text splicing for write-back: canvas edits become span-based replacements on the source text,
// which is then re-parsed. Untouched text stays byte-identical.

import type { Span } from "./model.ts";

export interface TextEdit {
  span: Span;
  newText: string;
}

/**
 * Applies edits whose spans refer to the original text. Edits must not overlap; insertions
 * (empty spans) at the same offset are applied in the given order. Throws on invalid input.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = edits
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.span.start - b.e.span.start || a.e.span.end - b.e.span.end || a.i - b.i)
    .map(({ e }) => e);
  let out = "";
  let pos = 0;
  for (const { span, newText } of sorted) {
    if (span.start < pos || span.end < span.start || span.end > text.length)
      throw new RangeError(`Invalid or overlapping edit span [${span.start}, ${span.end})`);
    out += text.slice(pos, span.start) + newText;
    pos = span.end;
  }
  return out + text.slice(pos);
}

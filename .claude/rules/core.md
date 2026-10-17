---
paths:
  - "packages/core/**"
---

# Core (parser, CST, model, write-back)

- The CST is lossless: `print(parse(x)) === x` for any input, including syntax errors and
  half-typed text. Never "pretty print" or regenerate source.
- Canvas → code changes are **text splices** computed from CST spans (`writeback.ts`), then
  re-parsed. Keep comments, blank lines, indentation and CRLF of untouched text.
- Every write-back operation needs: an exact-output test, and a property test over
  `examples/*.spd` (valid code afterwards, model as expected).
- Parsing never throws; diagnostics carry `code` + `span`. New codes: `parse/…`, `model/…`.
- A grammar change must also update: `DESIGN.md` grammar section, the CodeMirror highlighter
  (`packages/editor/src/code.ts`), and the cheat sheet syntax (`profiles/src/cheatsheet.ts`).

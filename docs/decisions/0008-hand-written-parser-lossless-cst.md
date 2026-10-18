# 0008. A hand-written recursive-descent parser with a lossless CST

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 phase 1; `core/src/lexer.ts`, `cst.ts`, `parser.ts`

## Context

Write-back must keep the user's text ([0009](0009-write-back-is-text-splices.md)), and the editor
parses on every keystroke, so the parser must handle half-typed input gracefully. The grammar
is tiny ([0005](0005-one-generic-grammar.md)).

## Decision

A hand-written lexer and recursive-descent parser producing a **lossless concrete syntax tree**:
every token carries its whitespace and comments as trivia, so `print(parse(text)) === text` for
any input. Parsing never throws; errors become diagnostics and `Error` items, with resync at the
next identifier, `}` or end of file, and a same-line rule so a half-typed line doesn't swallow
the next statement.

## Consequences

- Write-back can splice text by span with confidence.
- Error recovery and messages are ours to tune for the DSL.
- The CodeMirror highlighter is a separate small stream language, so a grammar change touches
  three places (parser, highlighter, cheat sheet).

## Alternatives considered

- **Lezer:** good incremental parsing and CodeMirror integration, but another grammar language
  to maintain, and its tree isn't built for exact text-preserving edits. Not needed at this size.

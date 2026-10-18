# 0002. Layout lives in a sidecar file, not in the code

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** prototype default for open question "layout location" (spec 001); `layout/src/layout-io.ts`

## Context

The layout could live inline (a `layout { … }` block at the end of the `.spd`) or in a separate
file. Inline means one file to share; separate keeps code diffs clean.

## Decision

The layout lives in a sidecar next to the diagram: `<file>.spd.layout.json`
([format](../reference/layout-file.md)). The `.spd` holds no layout text.

## Consequences

- Code diffs never contain coordinates; write-back never has to edit layout text.
- Sharing a diagram means sharing two files (or losing the hand layout, which is recoverable).
- The JSON is written in model order, one entry per line, so its own diffs stay small.

## Alternatives considered

- **Inline `layout {}` block:** one file, but every drag would rewrite part of the code, and
  the AI would see and have to preserve geometry. Could come back as an export option.

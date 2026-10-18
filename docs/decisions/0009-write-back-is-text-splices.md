# 0009. Write-back is text splices, never regeneration

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 phase 6; `core/src/writeback.ts`, `core/src/edits.ts`

## Context

Canvas edits that change meaning (connect, delete, rename, add, move into a container) must
reach the code. Regenerating the file from the model would lose comments, ordering and
formatting, and produce huge diffs.

## Decision

Each structural edit is a small, targeted **text splice** computed from CST spans on the current
source. Everything not touched stays byte-identical (comments, blank lines, indentation, CRLF).
The result is re-parsed. The whole file is never regenerated from the model.

## Consequences

- Diffs of canvas edits look like hand edits.
- Every write-back operation needs an exact-output test and a property test over all examples.
- Adding a new structural edit means writing a new splice operation, not a printer.

## Alternatives considered

- **Model → text printer:** simpler to write, destroys the user's text.

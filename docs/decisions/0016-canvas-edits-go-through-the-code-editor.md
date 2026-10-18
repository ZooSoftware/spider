# 0016. Canvas edits go through the code editor; one history

- **Status:** accepted
- **Date:** 2026-10-18
- **Where:** spec 001 phase 6 and backlog B6 (phase 12); `editor/src/app.ts`, `history.ts`, `code.ts`

## Context

Canvas edits change the code (structural) or the layout (geometric). If the canvas rewrote the
file behind the code editor, the code pane, saving and undo would disagree. CodeMirror's undo
only knew about text, so drag/resize/unpin couldn't be undone, and two histories would drift.

## Decision

- Structural canvas edits become `TextEdit[]` applied as **normal CodeMirror transactions**, so
  they are visible in the code pane, saved, and part of history like typing.
- There is **one app-level history** of `{ text, layout, selection }` snapshots, one step per
  user action (drag end, resize end, line edit, unpin, reset, a burst of typing, a structural
  edit), capped at 200. `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` in both panes use it; CodeMirror's
  history is bypassed. Restoring a snapshot writes both files through the normal save path.

## Consequences

- Code and canvas can never disagree about what the last step was.
- Every new gesture must `commit()` once at its end.
- History lives in memory for the session. Named versions (e.g. via git) are a separate feature.

## Alternatives considered

- **Separate histories for text and layout:** they get out of sync as soon as one action touches both.
- **CodeMirror history for text + a layout-only history:** same problem.

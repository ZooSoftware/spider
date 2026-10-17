---
paths:
  - "packages/editor/**"
---

# Editor

- Parse/layout/route/render run in the browser; the server only does file IO, profile
  loading and SSE. It binds to 127.0.0.1 only.
- Canvas edits that change meaning go through `edit(...)` → `code.apply(...)` (a CodeMirror
  transaction), never by rewriting the file. Layout-only edits change `state.layout`.
- One history: call `commit()` once at the end of each user action (drag end, resize end,
  line edit end, unpin, reset). Code edits commit after their recompile (`commitPending`).
  Undo/redo keys in both panes go to the app history, not CodeMirror's.
- The SVG is re-rendered on every frame: don't rely on native `dblclick` or on element
  identity between events. Floating panels inside the canvas must stop `pointerdown`/`wheel`.
- Server watcher: never echo our own writes back (`known`, `writing`, `version` guards).
- Verify UI changes in a real browser — use the `browser-test` skill.

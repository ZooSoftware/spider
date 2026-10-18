# Editor

`spider dev <file.spd>` opens a two-way editor on `http://127.0.0.1:4321`: CodeMirror on the
left, the rendered diagram on the right. `?debug` exposes `__spider` (`history`, `state`, `io`)
in the browser console.

## Split of work

```
 Browser (editor/src/*.ts, no Node)                    Bun dev server (server.ts)
 ┌──────────────────────────────────────────────┐      ┌──────────────────────────┐
 │ code.ts  ──text──► app.ts ──analyze──► state │ HTTP │ GET  /api/doc            │
 │ (CM6)    ◄─edits──  │  ▲                     │◄────►│ PUT  /api/text, /layout  │──► .spd, .layout.json
 │                     ▼  │                     │      │ POST /api/profile        │──► profiles on disk
 │ canvas.ts ◄─svg── renderSvg   commands.ts    │ SSE  │ GET  /api/events         │◄── fs.watch
 │ (gestures)──────────────────►(pure layout ops)│◄─────│ (external changes)       │
 └──────────────────────────────────────────────┘      └──────────────────────────┘
```

Parse, layout, routing and render run **in the browser**; the server only does file IO,
profile loading and pushes external changes. It binds to `127.0.0.1` only
([0015](../decisions/0015-pipeline-runs-in-the-browser.md)).

## Modules

| File | Job |
|---|---|
| `app.ts` | state, history and wiring only |
| `canvas.ts` | shows the SVG, owns the camera (pan/zoom via `viewBox`), turns pointer input into gestures in diagram coordinates |
| `commands.ts` | what a gesture does to the layout, as pure functions over the scene: move, resize + min size, segment/end drags, reset route, unpin, id re-key, new node box |
| `overlay.ts` | pins, overlap warnings, drop target, manual-route markers, selection handles, the connection being drawn |
| `code.ts` | CodeMirror pane ([techs/codemirror.md](../techs/codemirror.md)) |
| `history.ts` | undo/redo of snapshots, pure |
| `io.ts` | the server client, profile cache, SSE |
| `inline-input.ts` | one floating input for label and id rename |
| `palette.ts`, `panels.ts`, `zoom.ts`, `export.ts` | palette of kinds, resizable split, zoom control, SVG/PNG download |
| `server.ts` | the dev server |

A new gesture = a new pure command in `commands.ts` + a test in `tests/commands.test.ts`.

## The three edit directions

| Direction | Trigger | Path |
|---|---|---|
| code → canvas | typing (debounced) | `recompile(text)` → `analyze` with the current layout as `previous` → new state → draw → save layout |
| canvas → layout | drag, resize, line edits, unpin, reset layout | a pure command updates `state.layout` → re-route, draw → save layout. The model is untouched |
| canvas → code | connect, delete, rename (label / id), add from palette, drop into a container | a `core` write-back op → `TextEdit[]` → applied as a CodeMirror transaction → normal code → canvas path ([0016](../decisions/0016-canvas-edits-go-through-the-code-editor.md)) |

This follows the edit routing table: geometric edits touch the layout only; structural edits
touch the model, and the layout when needed (e.g. a renamed id re-keys its entries).

| Edit on the canvas | Model | Layout |
|---|---|---|
| move / resize a node, bend a line, change a port side | — | ✅ |
| add a node | ✅ | ✅ (its position) |
| draw a line | ✅ | ✅ (its route) |
| delete a node or line | ✅ | ✅ (entries removed) |
| rename a label | ✅ | — |
| rename an id | ✅ | ✅ (entries re-keyed) |
| drop a node into / out of a container | ✅ (statement moved) | ✅ |

Details:
- Dragging a node pins it. "Reset layout" re-lays out unpinned nodes around pinned ones;
  "Unpin all" + reset = fresh layout. `spider build --reset` discards everything.
- Positions of nodes that vanish while typing (an id mid-edit) are **remembered for the
  session** and restored when the id comes back.
- While dragging, containers keep their size so a node can be dragged out of one.
- Resize handles: leaf nodes set their size; containers set a minimum size.
- Layout diagnostics (container overlaps) are recomputed on every drag, model diagnostics only on recompile.

## History

One app-level history of `{ text, layout, selection }` snapshots, one step per user action,
capped at 200 ([0016](../decisions/0016-canvas-edits-go-through-the-code-editor.md)):

- `commit()` once at the end of each action: drag end, resize end, line edit end, unpin, reset;
- typing commits after a burst (debounced); canvas → code edits commit after their recompile
  (`commitPending`);
- `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` in both panes use it (CodeMirror's history is bypassed);
- restoring a snapshot writes both files through the normal save path.

## Saving and external changes

- Text and layout are saved separately, debounced (400ms), via `PUT /api/text` / `/api/layout`.
- The server watches the diagram's folder. A change it didn't write is pushed over SSE; the
  editor replaces its text/layout and recompiles ([0018](../decisions/0018-concurrent-edits-last-write-wins.md)).
- Our own writes never echo back: the server keeps the last content `known` on disk, a
  `writing` counter and a `version` per file, and drops reads that overlap a save.

## Rules of thumb

- The SVG is re-rendered on every frame: don't rely on native `dblclick` or element identity
  between events.
- Floating panels inside the canvas stop `pointerdown` and `wheel`.
- Verify UI changes in a real browser (`browser-test` skill).

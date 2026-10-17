# Spider — Prototype Plan

Goal: a working prototype you can **test and review**: write a `.spd` file, get an SVG,
open it in a web editor, drag things around, draw a connection, and see the code update.

Tooling: **Bun** (workspaces, `bun test`, `bun run`, Bun's built-in bundler/dev server).

## Prototype defaults for the open questions (DESIGN.md §9)

Chosen to keep the prototype simple. All can be revisited after review.

| Question | Prototype choice |
|---|---|
| Layout location | **Sidecar** `diagram.spd.layout.json` (no layout text in code; simpler write-back) |
| ID strategy | **Explicit IDs required** for nodes (`service api "API"`) |
| Edge IDs | `a->b`; duplicates get `a->b#2`, `a->b#3` in source order |
| Orphan layout | Dropped on save |
| Conflicts | Last write wins; editor reloads on file change |
| Extension | `.spd` |
| Canvas | Reuse the `render` SVG + a small interaction layer (one renderer, so what you see is what you export). Revisit xyflow if interaction gets complex |

---

## Phase 0 — Scaffold

- [x] Bun workspace root (`package.json` workspaces, `tsconfig.json`, strict ESM; packages export `src/index.ts` directly)
- [x] Empty packages: `core`, `profile-schema`, `profiles`, `layout`, `render`, `cli`, `editor`
- [x] Root scripts: `bun test`, `bun run typecheck` (`tsc --noEmit`), `bun run spider`
- [x] `.gitignore`, `examples/` folder
- [x] Update `CLAUDE.md` Commands section

**Done when:** `bun install && bun test && bun run typecheck` pass on the empty workspace.

## Phase 1 — Core: grammar, parser, model

- [x] Grammar v0 (documented in `DESIGN.md`):
  - `use <profile>[@version] [as alias]`
  - node: `kind id "label"? { props }?` (props `key: value`)
  - container: `kind id "label"? { children... }`
  - edge: `a -> b [: kind] ["label"]`
  - `#` comments
- [x] Lexer with positions; tokens keep surrounding whitespace/comments (trivia)
- [x] Recursive-descent parser → syntax tree with source spans; error recovery + diagnostics
- [x] Printer: syntax tree → text, **byte-identical** for unedited trees
- [x] Model builder: syntax tree → `Model { nodes, edges, containers }` with stable IDs
      (incl. `a->b#n` for duplicate edges); diagnostics for duplicate/unknown IDs
- [x] Tests: parse/print round trip over fixtures, model building, error cases

**Done when:** every fixture round-trips byte-identically, and models are correct.

## Phase 2 — Profiles

- [x] `profile-schema`: Zod schema for `profile.yaml` (nodes, edges, containment, rules,
      layout hints, theme), exported types
- [x] `profiles` loader: resolve `use` from local folders, `extends` merging, namespacing
      (`alias.kind`), SVG sanitization
- [x] Built-in `base/architecture`: `service`, `db`, `queue`, `cache`, `external`, `user`,
      container `zone`; edge kinds `calls`, `async`, `data`; simple SVG icons
- [x] Validation: unknown kind (warning, kept losslessly), containment rules,
      allowed edges, `forbid` rules
- [x] Tests: loading, extends, validation messages

**Done when:** a diagram using `base/architecture` validates, with useful diagnostics.

## Phase 3 — Layout

- [x] Layout file format (`*.layout.json`): `{ version, nodes: {id: {x,y,w,h,pinned}}, edges: {id: {points, sourcePort, targetPort}} }`
- [x] ELK adapter for **placement**: model + profile hints → ELK graph (layered, ports,
      nested containers) → positions
- [x] Own synchronous orthogonal **router** (obstacle avoidance, ports, bend minimization,
      parallel-segment nudging). Used for all final routes, and by the editor while dragging
- [x] Incremental layout: pinned nodes fixed, existing nodes kept close, new nodes placed;
      manually routed edges keep their waypoints
- [x] Merge + orphan cleanup
- [x] Tests: stability (adding a node doesn't move pinned nodes), orphan removal

**Done when:** re-running layout after adding a node leaves pinned nodes exactly in place.

## Phase 4 — Render + CLI  ⭐ Review milestone 1

- [x] `render`: model + layout + profile → standalone SVG (icons, labels, containers,
      orthogonal edges, arrowheads, edge labels, theme)
- [x] `cli`:
  - `spider build <file.spd> [-o out.svg]` (creates/updates the layout sidecar)
  - `spider check <file.spd>` (diagnostics)
  - `spider layout --reset <file.spd>`
- [x] Shape-aware edge endpoints (diamond, parallelogram, hexagon, ellipse)
- [x] `examples/`: checkout architecture, a bigger one (~20 nodes) to test overlaps

**You review:** run the CLI on the examples, open the SVGs, edit the `.spd` and rebuild,
and confirm the layout stays stable.

## Phase 5 — Editor: code ⇄ canvas, geometric edits  ⭐ Review milestone 2

- [x] `spider dev <file.spd>`: Bun server that serves the editor and reads/writes the
      `.spd` + layout files, and watches for external changes
- [x] Editor UI: CodeMirror 6 (left) + SVG canvas (right), pan/zoom
- [x] Code → canvas: live re-parse + incremental layout as you type; diagnostics shown inline
- [x] Canvas geometric edits → layout file: drag node (auto-pins), resize, unpin,
      "reset layout"
- [x] Edges re-route live while dragging

Implementation notes:
- Parse, layout, routing and render run **in the browser**; the server only does file IO,
  profile loading and SSE for external changes. Server binds to 127.0.0.1.
- Positions of nodes that vanish while typing (e.g. an id mid-edit) are remembered for the
  session and restored when the id comes back.
- **Reset layout** re-lays out unpinned nodes around pinned ones; **Unpin all** + reset =
  fresh layout. (`spider build --reset` still discards everything.)
- Resize handle only on leaf nodes (containers fit their children).

**You review:** type in the code and watch the diagram update; drag nodes, save,
reload, and confirm positions persist and the code is untouched.

## Phase 6 — Editor: structural write-back  ⭐ Review milestone 3

- [x] Draw a connection between two nodes → inserts `a -> b` into the code
- [x] Delete a node/edge → removes its lines (and its edges' lines) from the code
- [x] Edit a label inline → updates the string in the code
- [x] Add a node from a profile palette → inserts `kind id "Label"` (in its container if dropped in one)
- [x] All edits are targeted syntax-tree edits; round-trip tests for each operation

- [x] Move a node into / out of a container by dragging it onto a box (membership is code)
- [x] Canvas Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y route to the code editor's history

Implementation notes:
- `core/src/writeback.ts`: `addEdge`, `addNode`, `deleteElements`, `setLabel`, `moveNode` take
  the current source and return `TextEdit[]`; property-tested over all examples.
- The editor applies them as normal CodeMirror transactions → they appear in the code pane,
  are saved, and are undoable (code history only; layout-only undo is backlog B6).
- Removing a statement between two blank lines also removes one blank line.
- While dragging, containers keep their size so a node can be dragged out of one.

**You review:** do structural edits on the canvas, then check the code diff:
comments and formatting should be intact.

## Phase 7 — Polish (after review)

- [ ] PNG export
- [ ] AI cheat sheet generator: `spider profile-doc base/architecture`
- [ ] Custom profile example in `examples/profiles/` (your own icons and rules)
- [ ] Rename ID from the canvas (rekey layout)
- [ ] Notes from review sessions

---

## Backlog phases (easy → hard)

Fixes from review, ordered by difficulty. Details and "done when" criteria live in
`BACKLOG.md` (B1–B8). Phase 7 (polish) is deferred until after these.

### Phase 8 — Editor quick wins: B5 + B7  (easy)
Pure editor UI, no changes to core/layout/render.
- [x] B5: draggable divider between code and canvas; double-click collapses/expands the code
      panel; width remembered in `localStorage`
- [x] B7: zoom control in the canvas corner (slider 10–400%, −/+, 100%, Fit); gentler wheel
      step; slider and wheel stay in sync

### Phase 9 — Text scales with node size: B3  (easy–medium)
Render only, nothing new stored.
- [x] Font size, line height, icon size and padding scale with node size vs. kind default
      (clamped 0.75×–2×); wrapping uses the scaled font
- [x] Render tests; check in the editor while resizing

### Phase 10 — Containers fit their real content: B8  (medium)
Layout + editor.
- [x] Containers always fit their children exactly (drop "pinned only grows")
- [x] Container resize handle sets a *minimum* size (never smaller than content)
- [x] A container overlapping a node that is not inside it: warning outline in the editor +
      `layout/overlaps-container` warning (never auto-moved, see BACKLOG design rules)
- [x] Layout tests: container (pinned or not) shrinks back when children move closer; min size
      respected but never below content; overlaps reported

### Phase 11 — Router quality: B2 + B1  (medium–hard)
Router only (`layout/src/router.ts`), verified on the examples and the 100-node graph.
- [x] B2: segments never run along a container border (soft obstacle / nudge away ≥ 8–10px)
- [x] B1: every edge ends (and starts) with a straight segment ≥ arrowhead + 12px; prefer
      another side over a too-short stub; render clamps corner radius so it never eats it
- [x] Router tests for both properties; perf stays < 16ms for 100 nodes/150 edges

### Phase 12 — Unified undo/redo: B6  (medium–hard)
Editor architecture.
- [x] One app-level history of `{ text, layout, selection }` snapshots per user action
      (drag end, resize, unpin, reset, typing burst, structural edits)
- [x] Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y from both panes use it (CodeMirror history bypassed)
- [x] Restoring a snapshot writes both files; cap ~200 steps
- [x] Tests on the history module; browser check of type → drag → resize → type undo/redo

### Phase 13 — Move lines: B4  (hard)
Needs Phase 11 (router handles manual edges cleanly) and Phase 12 (line edits are undoable).
- [ ] Drag a line segment perpendicular to re-route; neighbours adjust to stay orthogonal
- [ ] Drag a line end along a node side to change its port
- [ ] Stored as `manual` points / ports in the layout file; moving a connected node keeps
      the manual route orthogonal; manual lines get a marker
- [ ] "Reset route" per line; tests for persistence across reload/rebuild

## Out of the prototype

libavoid routing, VS Code extension, MCP server, code plugins (`plugin.ts`),
npm/git profile sources, draw.io export, multi-user editing.

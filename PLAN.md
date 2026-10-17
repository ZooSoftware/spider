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

- [ ] Grammar v0 (documented in `DESIGN.md`):
  - `use <profile>[@version] [as alias]`
  - node: `kind id "label"? { props }?` (props `key: value`)
  - container: `kind id "label"? { children... }`
  - edge: `a -> b [: kind] ["label"]`
  - `#` comments
- [ ] Lexer with positions; tokens keep surrounding whitespace/comments (trivia)
- [ ] Recursive-descent parser → syntax tree with source spans; error recovery + diagnostics
- [ ] Printer: syntax tree → text, **byte-identical** for unedited trees
- [ ] Model builder: syntax tree → `Model { nodes, edges, containers }` with stable IDs
      (incl. `a->b#n` for duplicate edges); diagnostics for duplicate/unknown IDs
- [ ] Tests: parse/print round trip over fixtures, model building, error cases

**Done when:** every fixture round-trips byte-identically, and models are correct.

## Phase 2 — Profiles

- [ ] `profile-schema`: Zod schema for `profile.yaml` (nodes, edges, containment, rules,
      layout hints, theme), exported types
- [ ] `profiles` loader: resolve `use` from local folders, `extends` merging, namespacing
      (`alias.kind`), SVG sanitization
- [ ] Built-in `base/architecture`: `service`, `db`, `queue`, `cache`, `external`, `user`,
      container `zone`; edge kinds `calls`, `async`, `data`; simple SVG icons
- [ ] Validation: unknown kind (warning, kept losslessly), containment rules,
      allowed edges, `forbid` rules
- [ ] Tests: loading, extends, validation messages

**Done when:** a diagram using `base/architecture` validates, with useful diagnostics.

## Phase 3 — Layout

- [ ] Layout file format (`*.layout.json`): `{ version, nodes: {id: {x,y,w,h,pinned}}, edges: {id: {points, sourcePort, targetPort}} }`
- [ ] ELK adapter for **placement**: model + profile hints → ELK graph (layered, ports,
      nested containers) → positions
- [ ] Own synchronous orthogonal **router** (obstacle avoidance, ports, bend minimization,
      parallel-segment nudging). Used for all final routes, and by the editor while dragging
- [ ] Incremental layout: pinned nodes fixed, existing nodes kept close, new nodes placed;
      manually routed edges keep their waypoints
- [ ] Merge + orphan cleanup
- [ ] Tests: stability (adding a node doesn't move pinned nodes), orphan removal

**Done when:** re-running layout after adding a node leaves pinned nodes exactly in place.

## Phase 4 — Render + CLI  ⭐ Review milestone 1

- [ ] `render`: model + layout + profile → standalone SVG (icons, labels, containers,
      orthogonal edges, arrowheads, edge labels, theme)
- [ ] `cli`:
  - `spider build <file.spd> [-o out.svg]` (creates/updates the layout sidecar)
  - `spider check <file.spd>` (diagnostics)
  - `spider layout --reset <file.spd>`
- [ ] `examples/`: checkout architecture, a bigger one (~20 nodes) to test overlaps

**You review:** run the CLI on the examples, open the SVGs, edit the `.spd` and rebuild,
and confirm the layout stays stable.

## Phase 5 — Editor: code ⇄ canvas, geometric edits  ⭐ Review milestone 2

- [ ] `spider dev <file.spd>`: Bun server that serves the editor and reads/writes the
      `.spd` + layout files, and watches for external changes
- [ ] Editor UI: CodeMirror 6 (left) + SVG canvas (right), pan/zoom
- [ ] Code → canvas: live re-parse + incremental layout as you type; diagnostics shown inline
- [ ] Canvas geometric edits → layout file: drag node (auto-pins), resize, unpin,
      "reset layout"
- [ ] Edges re-route live while dragging

**You review:** type in the code and watch the diagram update; drag nodes, save,
reload, and confirm positions persist and the code is untouched.

## Phase 6 — Editor: structural write-back  ⭐ Review milestone 3

- [ ] Draw a connection between two nodes → inserts `a -> b` into the code
- [ ] Delete a node/edge → removes its lines (and its edges' lines) from the code
- [ ] Edit a label inline → updates the string in the code
- [ ] Add a node from a profile palette → inserts `kind id "Label"` (in its container if dropped in one)
- [ ] All edits are targeted syntax-tree edits; round-trip tests for each operation

**You review:** do structural edits on the canvas, then check the code diff:
comments and formatting should be intact.

## Phase 7 — Polish (after review)

- [ ] PNG export
- [ ] AI cheat sheet generator: `spider profile-doc base/architecture`
- [ ] Custom profile example in `examples/profiles/` (your own icons and rules)
- [ ] Rename ID from the canvas (rekey layout)
- [ ] Notes from review sessions

---

## Out of the prototype

libavoid routing, VS Code extension, MCP server, code plugins (`plugin.ts`),
npm/git profile sources, draw.io export, multi-user editing.

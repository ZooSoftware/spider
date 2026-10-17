# 002 — Clean architecture: plan

Status: ✅ done (phases 0, A–D).

Goal: keep the code easy to grow after the prototype, without changing behaviour.

Approach: **module + layer**, not full Clean Architecture. Each package is a module; the
package graph already points inward (`cli`/`editor` → `render`/`layout`/`profiles` → `core`)
and `core`/`layout`/`render` are pure functions, so they get no extra layers. Structure is
added only where a package has real state or IO (the editor), and boundaries are enforced
by a test instead of folder names.

Safety net for every phase: the existing tests, `bun run typecheck`, the `visual-check`
skill for router/render changes, the `browser-test` skill for editor changes.

## Phase 0 — Specs and test folders

- [x] `spec/` holds all plans: 001 = the prototype plan and its backlog, `spec/README.md` index
- [x] Tests move from `src/*.test.ts` to `packages/<pkg>/tests/` (helpers too); typecheck
      covers `tests/` and `scripts/`
- [x] References updated (`CLAUDE.md`, `README.md`, `.claude/` rules and skills)

## Phase A — Boundaries and docs  (easy)

- [x] Architecture test (`tests/architecture.test.ts`): allowed imports between packages,
      declared in `package.json`, relative imports stay in their package; `node:*` only in
      `cli`, `editor/src/server.ts` and `profiles/src/load.ts`
- [x] Runtime boundaries in the typecheck: `tsconfig.pure.json` (core, profile-schema,
      layout, pure profiles files: no DOM, no Node/Bun) and `tsconfig.browser.json` (editor
      browser code: no Node/Bun). Found and fixed: `elk-adapter.ts` referenced `document`
- [x] Docs drift: `CLAUDE.md`/`DESIGN.md` said React + xyflow and ELK in a Web Worker (done in phase 0)
- Decided against removing `node:fs` from `profiles/load.ts`: the browser never loads
  profiles (the server does), and the browser typecheck now guarantees it can't by accident.

## Phase B — Split the router  (easy, pure move)

- [x] `layout/src/router.ts` (~1000 lines) split by concern into `layout/src/router/`
      (types, obstacles, context, geom, slots, candidates, astar, nudge, cleanup, finish;
      `index.ts` keeps `routeEdges` and the pipeline); public API unchanged
- [x] Verified: old and new router give byte-identical routes on every example (fresh and
      saved layouts, with and without previous routes); perf 13ms for 100 nodes / 150 edges

## Phase C — Engine package  (medium)

- [x] `@spider/engine`: the pipeline shared by the CLI, the editor and future hosts (MCP,
      VS Code). Browser-safe entry: `analyze(text, profileSource, { previous, reset })`,
      `layoutDiagnostics`, `allDiagnostics`; profile loading is injected (disk in the CLI,
      HTTP in the editor). Node entry `@spider/engine/node`: `compile`, `layoutPathFor`,
      `profileSearchPaths`/`searchPathsFor`, `profilesFromDisk`
- [x] `compile` moves out of `render`; `render` no longer depends on `profiles` and loses its
      `./render` sub-path export; the example quality test moves to `engine/tests`
- [x] CLI and editor (app + server) use the engine; duplicated search paths and sidecar
      path removed; boundary rules and the pure typecheck cover `engine` and `render`

## Phase D — Editor layers  (medium–hard)

- [x] `editor/src/app.ts` (849 → 602 lines) split: `commands.ts` (pure layout commands:
      move, resize + min size, segment/end drags, reset route, unpin, id re-key, new node box),
      `overlay.ts`, `io.ts` (server client, profile cache), `inline-input.ts` (one input for
      label and id rename, was duplicated), `palette.ts`; `app.ts` keeps state, history, wiring.
      The editor's pipeline is `engine.analyze` (phase C)
- [x] Browser-free tests: `tests/commands.test.ts`, `tests/overlay.test.ts` (17 tests)
- [x] Browser check of the whole editor: 18 steps with real mouse/keyboard events (drag,
      undo/redo, segment drag, reset route, connect, label + id rename, container resize,
      palette drop, delete, undo to start, external edit), files checked on disk, no console
      errors. Run in headless Chrome over CDP because the Chrome extension wasn't connected

# 002 — Clean architecture: plan

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

- [ ] `layout/src/router.ts` (~1000 lines) split by concern into `layout/src/router/`;
      public API and behaviour unchanged, perf stays < 16ms for 100 nodes / 150 edges

## Phase C — Engine package  (medium)

- [ ] `@spider/engine`: the pipeline shared by the CLI, the editor and future hosts (MCP,
      VS Code). Browser-safe entry (`analyze`, diagnostics) and a Node entry
      (`@spider/engine/node`: `compile` from disk, sidecar path, profile search paths)
- [ ] `compile` moves out of `render`; `render` no longer depends on `profiles`
- [ ] CLI and editor (app + server) use the engine; duplicated search paths removed

## Phase D — Editor layers  (medium–hard)

- [ ] `editor/src/app.ts` (~850 lines) split: pure canvas commands (move, resize, line ends,
      rename id, reset route…), overlay drawing, server IO, inline inputs, palette; `app.ts`
      keeps the state, history and wiring
- [ ] Browser-free tests for the commands and the overlay
- [ ] Browser check of the whole editor (`browser-test` skill)

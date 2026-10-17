---
paths:
  - "packages/engine/**"
  - "packages/*/package.json"
  - "tests/**"
  - "tsconfig*.json"
---

# Architecture (module + layer)

- Each package is a module. Pure packages (`core`, `profile-schema`, `layout`, `render`, the
  browser entry of `engine`) stay plain functions: no DOM, no Node, no extra layers.
- Allowed package imports live in `tests/architecture.test.ts` (`ALLOWED`). Adding a
  dependency means updating `ALLOWED`, the package's `package.json` and, if it changes the
  direction, `CLAUDE.md`. Never add an arrow that points outward (e.g. `render` → `engine`).
- Node APIs only in `cli`, `editor/src/server.ts`, `engine/src/node.ts`, `profiles/src/load.ts`.
  `tsconfig.pure.json` and `tsconfig.browser.json` enforce the runtime side in `typecheck`.
- The pipeline is `engine.analyze`; hosts inject how profiles load. Don't re-assemble
  parse → layout → validate in a host.
- Tests live in `packages/<pkg>/tests/` and may use any package (e.g. `render` tests use
  `@spider/engine/node` as a devDependency); the boundary rules apply to `src/` only.

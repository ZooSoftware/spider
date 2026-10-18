# 0022. Module + layer, with boundaries enforced by tests

- **Status:** accepted
- **Date:** 2026-10-18
- **Where:** spec 002 phases A, B, D; `tests/architecture.test.ts`, `tsconfig.pure.json`, `tsconfig.browser.json`

## Context

After the prototype the code had to stay easy to grow. Full Clean Architecture (entities, use
cases, adapters in every package) would add layers to packages that are already pure functions.
Documented rules had already drifted (docs said React + xyflow and ELK in a Web Worker).

## Decision

- **Module + layer:** each package is a module with one job. Pure packages (`core`,
  `profile-schema`, `layout`, `render`, the `engine` browser entry) stay plain functions with no
  extra layers. Structure is added only where there is state or IO: the editor is split into
  `app` (state, history, wiring), pure `commands`, `overlay`, `io`.
- Large modules are split by concern (the router into `router/`).
- Boundaries are **enforced**, not just documented: allowed package imports and Node-API files in
  `tests/architecture.test.ts`; runtime boundaries in the pure and browser typechecks.

## Consequences

- An outward import or a stray `node:fs` fails `bun test` / `bun run typecheck`.
- New dependencies must be added to `ALLOWED` and `package.json` on purpose.
- Editor gestures are testable without a browser (`tests/commands.test.ts`).

## Alternatives considered

- **Full Clean Architecture per package:** ceremony without benefit for pure packages.
- **Folder conventions only:** they drift.
- **Removing `node:fs` from `profiles/load.ts`:** not needed; the browser never loads profiles
  and the browser typecheck guarantees it can't by accident.

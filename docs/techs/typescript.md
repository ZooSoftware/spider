# TypeScript

Strict TypeScript, ESM only, run directly by Bun (no transpile step). `tsc` is used only to
typecheck.

## Three typecheck configs

`bun run typecheck` runs all three; each one enforces a runtime boundary
([0022](../decisions/0022-module-and-layer-boundaries-enforced.md)):

| Config | Covers | Enforces |
|---|---|---|
| `tsconfig.json` | everything, incl. `tests/` and `scripts/` | the whole repo typechecks |
| `tsconfig.pure.json` | `core`, `profile-schema`, `layout`, `render`, pure `profiles` files, the browser entry of `engine` | no DOM and no Node/Bun types: these run anywhere |
| `tsconfig.browser.json` | the editor's browser code | DOM, but no Node/Bun: the browser can't import file IO by accident |

## Conventions

- No `any` in public APIs. Shared contracts are plain interfaces:
  `core/src/model.ts`, `profile-schema/src/index.ts`, `layout/src/layout-file.ts`.
- Imports include the `.ts` extension for relative files (`./layout.ts`).
- Spans are UTF-16 offsets (JavaScript string indices), half-open `[start, end)`.
- Parsers, loaders and the pipeline **never throw** on user input; problems are `Diagnostic`s.

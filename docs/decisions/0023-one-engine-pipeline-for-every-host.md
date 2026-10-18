# 0023. One engine pipeline for every host

- **Status:** accepted
- **Date:** 2026-10-18
- **Where:** spec 002 phase C; `packages/engine`

## Context

The CLI (`compile` lived in `render`) and the editor each assembled parse → profile → layout →
validate themselves, with duplicated profile search paths and sidecar paths. Future hosts (MCP
server, VS Code) would have added more copies.

## Decision

- `@spider/engine` owns the pipeline: `analyze(text, profileSource, { previous, reset })`, plus
  `layoutDiagnostics` / `allDiagnostics`. It is browser-safe.
- **Profile loading is injected** as a `ProfileSource`: disk in the CLI, HTTP in the editor.
- `@spider/engine/node` adds `compile` and the file conventions (`layoutPathFor`, profile search
  paths, `profilesFromDisk`).
- Rendering stays separate (the editor re-renders per frame without re-running the pipeline);
  `render` no longer depends on `profiles`.
- New hosts go through `engine`, never by re-assembling the pipeline.

## Consequences

- One place to change the pipeline; hosts differ only in IO.
- The example quality test lives in `engine/tests`.

## Alternatives considered

- **Keep `compile` in `render`:** render would keep depending on profile loading and disk.

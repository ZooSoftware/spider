# 0020. TypeScript and Bun everywhere; no JVM, no server

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** original design; [techs/](../techs/README.md)

## Context

PlantUML needs a JVM. The core has to run in the CLI, the browser editor and future hosts
(VS Code, an MCP server) without a service behind it.

## Decision

- **TypeScript end to end**, strict, ESM. The same pure packages run everywhere.
- **Bun** for workspaces, install, tests, scripts, bundling and the dev server; never npm/pnpm.
- Packages are consumed as TypeScript source (`exports: ./src/index.ts`); no build step.
- No JVM, and no server beyond the local dev server.

## Consequences

- One language and one toolchain; no build artefacts to keep in sync.
- Speed is bounded by JS. If it ever matters, `core`/`layout` could be ported to Rust → WASM;
  keep their TS interfaces clean so the swap stays possible. Not for v1.

## Alternatives considered

- **Node + npm/pnpm + a bundler:** more tools for the same result.
- **A native core (Rust) from the start:** premature.

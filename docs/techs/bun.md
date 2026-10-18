# Bun

Bun is the only tool we need: package manager, test runner, script runner, bundler and the
dev server. **Never npm or pnpm.**

| Use | How |
|---|---|
| Workspaces | root `package.json` → `"workspaces": ["packages/*"]`; packages depend on each other with `"workspace:*"` |
| Install | `bun install` (lockfile: `bun.lock`) |
| Tests | `bun test` (all), `bun test packages/core` (one package); tests import from `bun:test` |
| Scripts | `bun run typecheck`, `bun run spider <cmd>` (runs `packages/cli/src/main.ts` directly) |
| Dev server | `Bun.serve` with route objects in `editor/src/server.ts`; `index.html` is served as an HTML import, so Bun bundles the editor's TypeScript and CSS on the fly |
| PNG export (CLI) | `Bun.which` + `Bun.spawnSync` of an external converter (`rsvg-convert`, else `magick`), see [svg.md](svg.md) |

## Conventions

- Packages are consumed as **TypeScript source**: every `package.json` has
  `"exports": "./src/index.ts"` (plus sub-paths such as `@spider/engine/node`,
  `@spider/profiles/validate`). There is no build step and no `dist/`.
- Bun/Node APIs (`Bun.*`, `node:*`) are allowed only in the host files listed in
  [architecture](../architecture/README.md#boundaries); pure packages must build without them.
- `import.meta.dir` is used to find the built-in profiles folder (`profiles/src/load.ts`).
- Timing-sensitive tests (file watcher, server): run twice before trusting a failure.

# Techs

**TypeScript end to end, on Bun.** No JVM and no server process beyond the local dev server.
The same pure packages run in the browser, the CLI and future hosts (MCP server, VS Code).
Why: [0020](../decisions/0020-typescript-and-bun-everywhere.md).

| Layer | Choice | Version (lockfile) | Used in | Page |
|---|---|---|---|---|
| Runtime, package manager, tests, bundler, dev server | Bun | `@types/bun` 1.4 | everywhere | [bun.md](bun.md) |
| Language | TypeScript, strict, ESM, no build step | 5.9 | everywhere | [typescript.md](typescript.md) |
| Parser | Hand-written recursive descent (no library) | — | `core` | [0008](../decisions/0008-hand-written-parser-lossless-cst.md) |
| Node placement | ELK.js (`layered`) | 0.9.3 | `layout/src/elk-adapter.ts` | [elkjs.md](elkjs.md) |
| Line routing | Our own orthogonal router (no library) | — | `layout/src/router/` | [0010](../decisions/0010-elk-places-our-router-draws.md) |
| Rendering | Plain SVG strings (no DOM) | — | `render` | [svg.md](svg.md) |
| Canvas | The rendered SVG + a small interaction layer (no React, no xyflow) | — | `editor` | [0014](../decisions/0014-canvas-is-the-rendered-svg.md) |
| Code editor | CodeMirror 6 | 6.0.2 | `editor/src/code.ts` | [codemirror.md](codemirror.md) |
| Profile schema | Zod (+ `yaml` to read `profile.yaml`) | zod 3.25, yaml 2.9 | `profile-schema`, `profiles` | [zod-yaml.md](zod-yaml.md) |

Runtime dependencies are deliberately few: `elkjs`, `zod`, `yaml` and CodeMirror. Adding one
needs a reason in the package's page here, and it must respect the package's runtime
boundary ([architecture](../architecture/README.md#boundaries)).

## Considered, not used (yet)

| Tech | Status | Why |
|---|---|---|
| Lezer | not used | the grammar is tiny; a hand-written parser gives a lossless CST and our own error recovery ([0008](../decisions/0008-hand-written-parser-lossless-cst.md)) |
| ELK edge routing | not used | can't re-route synchronously while dragging, or around pinned/moved nodes ([0010](../decisions/0010-elk-places-our-router-draws.md)) |
| libavoid-js (WASM) | later, if our router stops being good enough | see [roadmap](../roadmap.md) |
| React, xyflow, tldraw | not used | one renderer for view and export; the interaction layer is small ([0014](../decisions/0014-canvas-is-the-rendered-svg.md)) |
| Monaco | not used | CodeMirror 6 is lighter and enough |
| ELK in a Web Worker | not used | placement is fast enough on the main thread at our sizes |
| npm / pnpm / Node-only tooling | not used | Bun does it all ([bun.md](bun.md)) |
| Rust → WASM for `core`/`layout` | possible later step, only if speed requires it | keep the TS interfaces clean so a swap stays possible |

# Architecture

Spider is a Bun workspace of small TypeScript packages, consumed as source. The style is
**module + layer** ([0022](../decisions/0022-module-and-layer-boundaries-enforced.md)): each
package is a module with one job; pure packages are plain functions; structure is added only
where there is state or IO (the editor). Boundaries are enforced by tests, not folder names.

| Page | Covers |
|---|---|
| [pipeline.md](pipeline.md) | `engine.analyze`, and how the CLI and the editor run it |
| [core.md](core.md) | lexer, lossless CST, parser, model builder, write-back |
| [profiles.md](profiles.md) | profile loading, `extends`, namespacing, validation, sanitizing, cheat sheets |
| [layout.md](layout.md) | placement (ELK), incremental layout, containers, the orthogonal router, manual lines |
| [render.md](render.md) | model + layout + profile → SVG |
| [editor.md](editor.md) | two-way sync, history, the dev server |
| [testing.md](testing.md) | what is tested where, and which invariants are enforced by tests |

## The two parts

Every diagram is a **model** and a **layout**, linked by stable IDs
([0001](../decisions/0001-model-and-layout-are-separate.md)):

| | Model | Layout |
|---|---|---|
| Holds | nodes, kinds, labels, props, containers, edges | positions, sizes, `pinned`, container min sizes, edge points, ports, `manual`, label positions |
| File | `diagram.spd` | `diagram.spd.layout.json` ([0002](../decisions/0002-layout-in-a-sidecar-file.md)) |
| Written by | people and AI (and canvas structural edits) | the editor and `spider build` |
| Contract | `core/src/model.ts` | `layout/src/layout-file.ts` |
| Never contains | coordinates | anything that isn't a model ID's geometry |

The model is the source of truth for **existence**: a model element with no layout entry is
auto-placed; a layout entry with no model element is an orphan and is dropped
([0004](../decisions/0004-orphan-layout-entries-dropped.md)).

## Packages

```
packages/
  core/            parser, lossless syntax tree, model, write-back           pure
  profile-schema/  profile format (Zod) + resolved types                     pure
  profiles/        loader/resolver, validation, SVG sanitizer, cheat sheet,  pure except load.ts
                   built-in profiles (builtin/base/architecture, base/flowchart)
  layout/          ELK placement, incremental layout, router, layout file IO pure
  render/          model + layout + profile → SVG                            pure
  engine/          the pipeline every host runs                              pure; /node entry uses disk
  cli/             spider build | check | layout | dev | profile-doc         host (Node/Bun)
  editor/          web app (browser) + dev server (server.ts)                host (browser + Bun)
```

### Dependency graph

Dependencies point **inward**. Hosts go through `engine`; nothing points outward.

```
        cli ───────────┐
         │             ▼
         │          editor ──(server.ts)──┐
         ▼             │                  │
       engine ◄────────┘◄─────────────────┘
       │   │   │
       ▼   ▼   ▼
  render layout profiles
     │    │  │   │
     ▼    ▼  ▼   ▼
   profile-schema   core
```

Exact allowed imports (from `tests/architecture.test.ts`):

| Package | May import |
|---|---|
| `core` | — |
| `profile-schema` | — (only `zod`) |
| `profiles` | `core`, `profile-schema` |
| `layout` | `core`, `profile-schema` |
| `render` | `core`, `profile-schema`, `layout` |
| `engine` | `core`, `profile-schema`, `profiles`, `layout`, `render` |
| `editor` | `core`, `profile-schema`, `profiles`, `layout`, `render`, `engine` |
| `cli` | everything above, including `editor` (to start the dev server) |

The editor also imports `core` (write-back), `layout` (layout file IO, line edits) and `render`
(it re-renders on every drag frame without re-running the pipeline). The CLI imports `editor`
only to start the dev server (`spider dev`).

### Boundaries

Enforced on every `bun test` and `bun run typecheck`:

- **Package imports** match the table above and each `package.json`; relative imports never
  leave their package (`tests/architecture.test.ts`).
- **Node/Bun APIs** (`node:*`, `Bun.*`) only in: `cli`, `editor/src/server.ts`,
  `engine/src/node.ts`, `profiles/src/load.ts`.
- **Runtime:** `tsconfig.pure.json` builds `core`, `profile-schema`, `layout`, `render`, the pure
  `profiles` files and the `engine` browser entry without DOM or Node types;
  `tsconfig.browser.json` builds the editor's browser code without Node types.
- `core` knows nothing about specific diagram types; built-in types are plain profiles
  ([0006](../decisions/0006-built-in-types-are-profiles.md)).

Adding a dependency means updating `ALLOWED` in the architecture test, the package's
`package.json` and, if it changes the direction, this page.

## Shared contracts

Changes to these are contract changes: additive only, with tests.

| Contract | File | Reference |
|---|---|---|
| Semantic model, spans, diagnostics | `core/src/model.ts` | [grammar](../reference/grammar.md), [diagnostics](../reference/diagnostics.md) |
| Profile format and resolved profile | `profile-schema/src/index.ts` | [profile format](../reference/profile-format.md) |
| Layout sidecar | `layout/src/layout-file.ts` | [layout file](../reference/layout-file.md) |
| Pipeline API | `engine/src/pipeline.ts` | [pipeline](pipeline.md) |

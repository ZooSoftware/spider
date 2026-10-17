# Spider

Diagram-as-code with a reverse flow: code → diagram, and canvas edits → code.
Full design and open questions: `DESIGN.md`. Read it before any architectural change.

## Status

Prototype complete (`v0.1.0`). All plans live in `spec/` (index: `spec/README.md`); the active
spec is `spec/002-clean-architecture/plan.md` (tick tasks as they land).
User guide: `README.md`. Claude setup (rules, skills, agents, hooks): `.claude/README.md`.
Review findings to fix later: `spec/backlog.md`.
Prototype defaults for open design questions: top of `spec/001-prototype/plan.md`.

## Core invariants (do not break)

- **Two parts:** the *model* (nodes, edges, containers, props, labels) and the *layout*
  (positions, sizes, waypoints, ports, pinned). The model never contains coordinates.
- **Stable IDs** link model and layout. Every node/edge must have one.
- **Model is the source of truth for existence.** Layout entries only describe model IDs;
  missing layout → auto-place; orphan layout → cleanup.
- **Edit routing:** geometric edits touch layout only; structural edits touch the model
  (and layout when needed). See the table in `DESIGN.md` §3.1.
- **Write-back preserves text.** Model edits are targeted edits on the syntax tree
  (comments, order, formatting kept). Never regenerate the whole file from the model.
- **Incremental layout:** pinned elements never move; existing ones stay close.
- **A user edit never moves other nodes.** Overlaps are shown, not auto-resolved (no cascades).
- **Unknown kinds/profiles are kept losslessly** and rendered as generic boxes.
- **One generic grammar.** Profiles give meaning to kinds; they never change syntax.
- **Built-in diagram types are profiles** using the same mechanism as user profiles.

## Stack

TypeScript everywhere, **Bun** (workspaces, `bun test`, built-in bundler/dev server;
never npm/pnpm). Parser: hand-written recursive descent.
Layout: ELK.js for placement + our own orthogonal router. Render: plain SVG.
Editor: CodeMirror 6 + the rendered SVG with a small interaction layer (no React).
Profile schema: Zod / JSON Schema. No JVM, no server.

## Package boundaries

```
packages/
  core/            parser, syntax tree, model, write-back, validation
  profile-schema/  profile format schema + types
  profiles/        loader/resolver + built-in profiles
  layout/          ELK adapter, incremental/pinned layout, routing
  render/          model + layout + profile → SVG
  cli/             spider build
  editor/          web app, two-way sync
```

- `core` has **no DOM, no React, and no knowledge of specific diagram types**.
- Dependencies point inward: `editor`/`cli` → `render`/`layout`/`profiles` → `core`.

## Conventions

- Strict TypeScript, ESM only. No `any` in public APIs.
- Tests in `packages/<pkg>/tests/*.test.ts` (helpers there too), importing `../src/…`. Parser and write-back changes need
  round-trip tests: `parse → edit → print` must keep untouched text byte-identical.
- Keep the DSL small and AI-friendly. Any grammar change needs a `DESIGN.md` update.
- User-supplied SVG assets must be sanitized before render.

## Commands

```sh
bun install
bun test                    # all tests; `bun test packages/core` for one package
bun run typecheck           # tsc --noEmit over packages/*/src
bun run spider build examples/checkout.spd --png   # → .svg/.png + .layout.json
bun run spider check <file.spd>                    # diagnostics only, exit 1 on errors
bun run spider dev examples/checkout.spd           # two-way editor on http://127.0.0.1:4321 (?debug)
bun run spider profile-doc base/architecture       # AI cheat sheet for a profile or a .spd
```

Packages are consumed as TypeScript source (`exports: ./src/index.ts`); no build step.
Shared contracts: `core/src/model.ts`, `profile-schema/src/index.ts`, `layout/src/layout-file.ts`.

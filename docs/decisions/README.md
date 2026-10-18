# Decisions

One record per decision that shapes spider (an ADR): the context, the decision, what it costs,
and what else was considered. Records explain **why**; how things work today is in
[architecture/](../architecture/README.md).

- Add one by copying [template.md](template.md) to the next number. Keep it short.
- An accepted record's decision is never rewritten. To change it, write a new record that
  supersedes it and mark the old one `superseded by NNNN`.
- Rules in `CLAUDE.md` and `.claude/rules/` should link the record they come from.
- Questions not decided yet live in [roadmap.md](../roadmap.md#open-questions).

## Index

**Read first:** [0025](0025-simple-and-compact-first.md), the guiding principle. Every feature
must pass its simplicity test.

| # | Decision | Area | Date |
|---|---|---|---|
| [0001](0001-model-and-layout-are-separate.md) | The model and the layout are separate, linked by stable IDs | model | 2026-10-17 |
| [0002](0002-layout-in-a-sidecar-file.md) | Layout lives in a sidecar file, not in the code | model | 2026-10-17 |
| [0003](0003-explicit-node-ids-edge-ids-from-endpoints.md) | Node IDs are explicit; edge IDs come from their endpoints | model | 2026-10-17 |
| [0004](0004-orphan-layout-entries-dropped.md) | Orphan layout entries are dropped; the editor remembers them for the session | model | 2026-10-17 |
| [0005](0005-one-generic-grammar.md) | One generic grammar; profiles never change syntax | grammar | 2026-10-17 |
| [0006](0006-built-in-types-are-profiles.md) | Built-in diagram types are ordinary profiles | profiles | 2026-10-17 |
| [0007](0007-unknown-kinds-kept-losslessly.md) | Unknown kinds and missing profiles are kept losslessly | profiles | 2026-10-17 |
| [0008](0008-hand-written-parser-lossless-cst.md) | A hand-written recursive-descent parser with a lossless CST | core | 2026-10-17 |
| [0009](0009-write-back-is-text-splices.md) | Write-back is text splices, never regeneration | core | 2026-10-17 |
| [0010](0010-elk-places-our-router-draws.md) | ELK places nodes; our own router draws every line | layout | 2026-10-17 |
| [0011](0011-user-edits-never-move-other-nodes.md) | A user edit never moves other nodes | layout | 2026-10-17 |
| [0012](0012-containers-fit-their-children.md) | Containers fit their children; a resize only sets a minimum | layout | 2026-10-17 |
| [0013](0013-line-quality-rules-and-manual-routes.md) | Line quality rules, and hand-routed lines | layout | 2026-10-17 |
| [0014](0014-canvas-is-the-rendered-svg.md) | The canvas is the rendered SVG plus a small interaction layer | editor | 2026-10-17 |
| [0015](0015-pipeline-runs-in-the-browser.md) | The pipeline runs in the browser; the server only does file IO | editor | 2026-10-17 |
| [0016](0016-canvas-edits-go-through-the-code-editor.md) | Canvas edits go through the code editor; one history | editor | 2026-10-18 |
| [0017](0017-container-membership-is-code.md) | Container membership is code | editor | 2026-10-17 |
| [0018](0018-concurrent-edits-last-write-wins.md) | Concurrent edits: last write wins, external changes are pushed | editor | 2026-10-17 |
| [0019](0019-namespaced-kinds-via-use-as.md) | Namespaced kinds via `use … as` | profiles | 2026-10-18 |
| [0020](0020-typescript-and-bun-everywhere.md) | TypeScript and Bun everywhere; no JVM, no server | stack | 2026-10-17 |
| [0021](0021-profiles-are-declarative.md) | Profiles are declarative; code plugins are deferred | profiles | 2026-10-17 |
| [0022](0022-module-and-layer-boundaries-enforced.md) | Module + layer, with boundaries enforced by tests | architecture | 2026-10-18 |
| [0023](0023-one-engine-pipeline-for-every-host.md) | One engine pipeline for every host | architecture | 2026-10-18 |
| [0024](0024-text-scales-with-node-size.md) | Text scales with node size; nothing is stored | render | 2026-10-17 |
| [0025](0025-simple-and-compact-first.md) | **Simple and compact first: fix the pains, don't become draw.io** | principle | 2026-10-18 |

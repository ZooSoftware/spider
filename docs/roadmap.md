# Roadmap

What is done, what is next, what is out of scope, and what is still open. Planned work moves
from here into a numbered spec in [`spec/`](../spec/README.md); the user sets priorities.
Every item must pass the simplicity test ([0025](decisions/0025-simple-and-compact-first.md))
before it becomes a spec.

## Done

**MVP** (spec 001, tagged `v0.1.0`), all shipped:

1. One profile, `base/architecture` (service, db, queue, cache, external, user, zone), plus `base/flowchart`.
2. Pipeline DSL → model → ELK placement → own router → SVG, through the CLI.
3. Web editor: drag + pin saved to the layout, stable across recompiles.
4. Structural write-back: connect, delete, rename label and id, add from a palette, move into/out of containers.
5. Profile loading from local folders, with `extends` and namespaces (`examples/profiles/acme/k8s`).
6. Export: SVG and PNG. AI cheat sheets (`spider profile-doc`).
7. Review fixes: unified undo/redo, movable lines, containers that fit their content, line quality rules.

**Clean architecture** (spec 002): enforced package boundaries, the router split, `@spider/engine`, editor layers.

## Later

- MCP server for AI (`check` / `build` / `profile-doc` as tools), through `@spider/engine`
- VS Code extension, through `@spider/engine`
- More profiles: C4, network (flowchart exists as a minimal built-in)
- libavoid-js routing, if our router stops being good enough ([0010](decisions/0010-elk-places-our-router-draws.md))
- draw.io XML export as an escape hatch
- Code plugins (`plugin.ts`), sandboxed and opt-in ([0021](decisions/0021-profiles-are-declarative.md))
- Profile sources: npm / git / URL, plus a lockfile; a separate `theme.yaml`
- Named versions / snapshots of a diagram (possibly via git)
- `fontScale` per node, if users want big boxes with normal text ([0024](decisions/0024-text-scales-with-node-size.md))
- Port `core`/`layout` to Rust → WASM, only if speed requires it

## Out of scope (v1)

- Anything that turns spider into a free-form editor: free shapes and text boxes, per-element
  colours/fonts, layers, styling panels ([0025](decisions/0025-simple-and-compact-first.md))
- Per-profile custom syntax ([0005](decisions/0005-one-generic-grammar.md))
- Public profile registry / marketplace
- Sequence diagrams (their layout is already fixed by message order; little benefit)
- Real-time multi-user collaboration

## Open questions

Questions from the original design, with where each stands. A settled one gets a decision record.

| # | Question | Status |
|---|---|---|
| 1 | Layout location: inline `layout {}` or sidecar? | settled: sidecar ([0002](decisions/0002-layout-in-a-sidecar-file.md)) |
| 2 | ID strategy: explicit or derived from labels? | settled: explicit ([0003](decisions/0003-explicit-node-ids-edge-ids-from-endpoints.md)). **Open:** what happens to layout entries when an id is renamed **in the code** (today the node is re-placed) |
| 3 | Orphan policy: drop at once, or keep for N saves? | settled for now: drop on save, remember in the editor session ([0004](decisions/0004-orphan-layout-entries-dropped.md)) |
| 4 | Edge IDs when several edges join the same nodes | settled: `a->b#2` ([0003](decisions/0003-explicit-node-ids-edge-ids-from-endpoints.md)). **Open:** reordering duplicates in code swaps their stored routes |
| 5 | Code and canvas edited at the same time | settled for now: last write wins ([0018](decisions/0018-concurrent-edits-last-write-wins.md)). **Open:** merge, if it becomes a real problem |
| 6 | File extension | settled: `.spd` |
| 7 | Is ELK good enough for architecture diagrams, or do profiles need custom hints early? | **open:** ELK places, our router draws ([0010](decisions/0010-elk-places-our-router-draws.md)); `layout.layer` is the only hint so far |

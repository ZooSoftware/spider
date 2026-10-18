# ELK.js

[ELK.js](https://github.com/kieler/elkjs) (0.9.3) is used for **node placement only**. All
lines are drawn by our own router ([0010](../decisions/0010-elk-places-our-router-draws.md)).

Where: `layout/src/elk-adapter.ts` (`elkPlace`).

## How we use it

- Model + profile → a **hierarchical** ELK graph: containers become compound nodes with
  their children inside (`hierarchyHandling: INCLUDE_CHILDREN`), so ELK keeps members together.
- Algorithm `layered`; direction, node spacing (default 50) and layer spacing (default 80)
  come from the profile's `layout` section.
- Node sizes come from the profile kind (`size`, or 140×60) plus label space; containers get
  padding and title space (`CONTAINER_PADDING` 20, `CONTAINER_TITLE_SPACE` 36).
- Kind hint `layout.layer: first | last` maps to ELK layer constraints.
- Edges are passed so ELK orders layers well; ELK's routes are ignored.
- ELK's output is converted to **absolute** rectangles (ELK gives coordinates relative to
  the parent).

## When ELK runs

| Situation | What ELK does |
|---|---|
| No layout yet, or `--reset` | full placement: every node takes ELK's position |
| New nodes added to an existing layout | ELK lays out the whole graph, but only the *new* nodes use it, as a hint to find a free spot near their neighbours (`incrementalPlacement`, `freeSpot`) |
| Nothing new | ELK is not called |

Existing nodes never take a new ELK position ([0011](../decisions/0011-user-edits-never-move-other-nodes.md)).

## Gotchas

- We import `elkjs/lib/elk.bundled.js` and run it **in-thread** (its "fake worker"), no Web
  Worker. The bundle decides at construction whether it is inside a worker by checking
  `typeof document === "undefined" && typeof self !== "undefined"`; Bun defines `self`, so
  `getElk()` hides `self` while constructing. Don't remove that dance.
- Spacing options must be set on the root **and** on every container: ELK does not inherit them.
- `layout` must stay DOM-free: an early version referenced `document` directly and the pure
  typecheck caught it; the adapter now only probes `globalThis`.
- ELK is async; the router is sync. That is why the editor can re-route on every drag frame
  without calling ELK.

# Layout

`packages/layout`: geometry for a model. ELK places nodes; our own router draws every line
([0010](../decisions/0010-elk-places-our-router-draws.md)). Pure, DOM-free.

| File | Job |
|---|---|
| `layout.ts` | `layoutDiagram`: reconcile → place → fit containers → route |
| `elk-adapter.ts` | model + profile → ELK graph → absolute rects ([techs/elkjs.md](../techs/elkjs.md)) |
| `geometry.ts` | rects, sizing rules, container fitting, overlap diagnostics |
| `layout-io.ts` | reconcile (orphans), tolerant parsing, stable serialization |
| `layout-file.ts` | the sidecar contract ([reference](../reference/layout-file.md)) |
| `edge-edit.ts` | pure manual-line gestures: move a segment, slide an end, which side a point is on |
| `router/` | the orthogonal router (below) |

## `layoutDiagram(model, profile, previous?, { reset })`

1. **Reconcile** `previous` with the model: drop orphan entries.
2. **Place:**
   - no previous positions (or `reset`): full ELK placement;
   - some nodes missing: **incremental** placement, only the missing nodes move;
   - nothing missing: positions are kept as they are, ELK is not called.
3. **Fit containers** to their children.
4. **Route** every edge (`routeEdges`), keeping manual routes.

Output entries are in model order (small git diffs).

### Incremental placement

Existing nodes never move ([0011](../decisions/0011-user-edits-never-move-other-nodes.md)).
New nodes are placed in *units*: the top-most missing nodes whose subtree contains nothing
placed (a missing container that wraps placed nodes is not a unit, its box comes from its
children). Units connected to placed nodes go first, so chains of new nodes grow outward.
Each unit is anchored to a placed edge neighbour (else the nearest placed leaf in ELK space)
and put at the nearest free spot (`freeSpot`). An ancestor container grows to fit the unit and
must not swallow unrelated nodes.

### Containers

A container's box always fits its real children (padding 20, title space 36). A user-set
`minW`/`minH` only adds room, never shrinks below content. A container drawn over a node that
isn't inside it gives a `layout/overlaps-container` warning and an outline in the editor; it is
never auto-resolved ([0012](../decisions/0012-containers-fit-their-children.md)).

## Router (`router/`)

Synchronous, deterministic, DOM-free; used by `layoutDiagram` and by the editor on every drag
frame. Budget: **< 16ms for 100 nodes / 150 edges** (about 12–13ms today).

| Step | File | What it does |
|---|---|---|
| context | `context.ts`, `obstacles.ts` | node infos, obstacle spatial index, container borders, one job per edge |
| 1. sides | `slots.ts`, `candidates.ts` | per edge, pick (source side, target side) by scoring cheap candidate routes (straight / L / Z / U) between side midpoints; honours kind `ports` and stored ports |
| 2. slots | `slots.ts` | spread edge ends that share a node side, ordered by the opposite node (fewer crossings); a lone facing pair is straightened |
| 3. route | `candidates.ts`, `astar.ts` | candidate shapes again with the real port points; if all collide, A* over a sparse orthogonal grid (obstacle boundaries + midlines) with a bend penalty |
| (2–3 run twice: slots by node, then by route) | | |
| 4. nudge | `nudge.ts` | spread overlapping collinear interior segments of different edges apart |
| cleanup | `cleanup.ts` | move segments off container borders, remove small jogs at ports |
| finish | `finish.ts` | self loops (on the least used side), re-snapped manual routes, label positions, output |

### Line invariants ([0013](../decisions/0013-line-quality-rules-and-manual-routes.md))

Tested on every example in `engine/tests/quality.test.ts`:

- routes are **orthogonal**;
- every arrow end keeps a straight run of at least `ARROW_STUB` = arrowhead (12) + 12 = 24px;
  the router prefers another side over a too-short stub, and render clamps corner radii so
  they never eat into it;
- no segment runs along a container border: it crosses it or stays `BORDER_GAP` (10px) away;
- `manual` routes are kept and only their ends are re-snapped.

Tuning constants live in `router/types.ts` (`ROUTE_MARGIN`, `STUB`, `BEND`, `SEP`, `FACING`,
`SLOT_GAP`, `BORDER_COST`).

### Manual lines

Editor gestures (`edge-edit.ts`, via `editor/src/commands.ts`):

- drag a segment sideways: the neighbouring segments adjust so the route stays orthogonal
  (a bend is added if needed); stored as `manual: true` + `points`;
- drag a line end along a node side or to another side: stored as `sourcePort` / `targetPort`,
  and the line is routed automatically to that side;
- moving a connected node keeps the manual interior points and fixes only the segments next to it;
- "reset route" removes the manual route / ports.

## Layout file IO

`parseLayoutFile` is tolerant: bad JSON or a non-object is an error and gives an empty layout;
an unsupported version or an invalid node/edge entry is a warning and that entry is ignored.
`serializeLayoutFile` writes entries in model order, one per line, so git diffs stay small.

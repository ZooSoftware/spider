# Layout file (`<file>.spd.layout.json`)

The geometry half of a diagram, next to the `.spd` ([0002](../decisions/0002-layout-in-a-sidecar-file.md)).
Owned by the editor and `spider build`; people and AI don't need to touch it.
Source of truth: `layout/src/layout-file.ts`, IO in `layout/src/layout-io.ts`.

```json
{
  "version": 1,
  "nodes": {
    "vpc": { "x": 200, "y": 40, "w": 520, "h": 300, "minW": 560 },
    "api": { "x": 240, "y": 120, "w": 140, "h": 60, "pinned": true }
  },
  "edges": {
    "api->order": { "points": [[380, 150], [460, 150]], "labelPos": [420, 140] },
    "order->stripe": { "points": [[530, 180], [530, 400], [700, 400]], "manual": true, "targetPort": "left" }
  }
}
```

- Keys are **model IDs**: node ids, and edge ids `a->b` / `a->b#2`.
- Coordinates are **absolute**, top-left origin, including nested nodes.

## Node entry

| Field | Type | Notes |
|---|---|---|
| `x`, `y`, `w`, `h` | number | box; containers are refitted to their children on every layout |
| `pinned` | boolean | never moves during layout; set when the user drags a node |
| `minW`, `minH` | number | containers only: user-set minimum size, never smaller than content |

## Edge entry

| Field | Type | Notes |
|---|---|---|
| `points` | `[x, y][]` | full orthogonal polyline from source boundary to target boundary, both ends included |
| `manual` | boolean | hand-routed: keep `points`, only re-snap the ends |
| `sourcePort`, `targetPort` | `left` `right` `top` `bottom` | side chosen by the user; routed automatically to it |
| `labelPos` | `[x, y]` | center of the edge label |

## Reading and writing

- **Orphans** (ids not in the model) are dropped on reconcile and so on the next save
  ([0004](../decisions/0004-orphan-layout-entries-dropped.md)). Missing entries are auto-placed.
- **Tolerant parsing:** invalid JSON or a non-object → `layout/invalid-json` /
  `layout/invalid-file` error and an empty layout; an unsupported `version` or a bad
  node/edge entry → a warning, and that entry is ignored.
- **Stable output:** entries in model order, one per line, so git diffs stay small.
- Changes to this format are **additive only**, and need the parse + serialize code and the
  round-trip test updated.

# 0011. A user edit never moves other nodes

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** design rule from the prototype review (spec 001 backlog, B8); `layout/src/layout.ts`, `geometry.ts`

## Context

When a resized node or a growing container covers a neighbour, the "obvious" fix is to push the
neighbour away. In practice pushing cascades through the diagram and destroys the layout the user
built, which is worse than one overlap the user fixes with a single drag.

## Decision

- Resizing a node doesn't push its neighbours; a container growing over a node doesn't move that
  node out.
- Incremental layout: pinned nodes never move, existing nodes keep their x/y, only new nodes are placed.
- Overlaps are **shown** (a warning outline in the editor, `layout/overlaps-container`), never
  resolved automatically.

## Consequences

- The layout is predictable: what you placed stays where you placed it.
- Diagrams can have visible overlaps until the user fixes them.
- Any "auto-fix" proposal must be opt-in and must be discussed first.

## Alternatives considered

- **Push neighbours / auto-resolve overlaps:** rejected for the cascades.

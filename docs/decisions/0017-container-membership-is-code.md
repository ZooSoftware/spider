# 0017. Container membership is code

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 phase 6, backlog B8; `core/src/writeback.ts` (`moveNode`), `editor/src/app.ts`

## Context

Dragging a node over a container makes it *look* inside, but membership means something in the
model (containment rules, layout grouping). Geometry alone can't be the truth.

## Decision

Membership is written in the code by nesting. Dropping a node onto a container **moves its
statement into that container's block** (and dragging it out moves it out), as a write-back edit.

## Consequences

- The model, validation and the drawn boxes always agree.
- A plain drag that ends over a container is a structural edit; the drop target is highlighted
  so the user sees it coming.
- While dragging, containers keep their size so a node can be dragged out of one.

## Alternatives considered

- **Membership from geometry:** the model would depend on coordinates, breaking [0001](0001-model-and-layout-are-separate.md).

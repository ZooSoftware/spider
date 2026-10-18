# 0001. The model and the layout are separate, linked by stable IDs

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** original design; `core/src/model.ts`, `layout/src/layout-file.ts`

## Context

Mermaid and PlantUML recompute the layout on every compile, so manual adjustments are
impossible. draw.io keeps geometry, but its XML mixes meaning and coordinates, so it is
verbose, hard to review and hard for an AI to write.

## Decision

A diagram has two parts:

- the **model**: nodes, kinds, labels, props, containers, edges. Written by people and AI.
  It **never contains coordinates**;
- the **layout**: positions, sizes, `pinned`, waypoints, ports. Owned by the editor; the AI ignores it.

Every node and edge has a **stable ID** that links the two. The model is the source of truth
for existence: a model element without layout is auto-placed; a layout entry without a model
element is an orphan.

## Consequences

- The code stays short, diffable and AI-friendly; geometry can be kept across compiles.
- Edits must be routed: geometric edits touch only the layout, structural edits touch the model
  (and the layout when needed). See the table in [architecture/editor.md](../architecture/editor.md).
- IDs must stay stable across edits, which shapes the ID rules ([0003](0003-explicit-node-ids-edge-ids-from-endpoints.md)).

## Alternatives considered

- **Coordinates in the model** (draw.io style): loses AI-friendliness and clean diffs.
- **No stored layout** (Mermaid style): no control after compile; the main problem we solve.

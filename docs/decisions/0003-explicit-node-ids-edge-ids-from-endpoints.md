# 0003. Node IDs are explicit; edge IDs come from their endpoints

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** prototype defaults for open questions "ID strategy" and "edge IDs" (spec 001); `core/src/build.ts`

## Context

Layout entries are keyed by ID ([0001](0001-model-and-layout-are-separate.md)), so IDs must
survive edits. IDs derived from labels would change whenever a label is edited. Edges rarely
have a natural name, and `a->b` is ambiguous when several edges join the same nodes.

## Decision

- Every node has an **explicit**, globally unique id: `service api "API Gateway"`.
- Edge ids are `a->b` for the first edge between `a` and `b`, then `a->b#2`, `a->b#3` in source order.

## Consequences

- Labels can change freely without touching the layout.
- Renaming an id **from the canvas** re-keys the layout (`renameId` + `renameEdgeId`). Renaming
  it **in the code** loses that node's layout entry (it is re-placed); still an open question
  ([roadmap](../roadmap.md#open-questions)).
- Reordering duplicate edges in the code swaps their `#n` and so their stored routes.

## Alternatives considered

- **IDs from labels:** fragile under renames.
- **Explicit edge names:** more syntax for little gain in typical diagrams.

# 0010. ELK places nodes; our own router draws every line

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 phase 3, phase 11; `layout/src/elk-adapter.ts`, `layout/src/router/`

## Context

Overlapping lines are the main visual problem of diagram-as-code tools. ELK can place and route,
but its routing is async, works on the whole graph, and can't honour pinned or hand-moved nodes,
or re-route live while the user drags a node.

## Decision

ELK.js is used **only for placement**. Every line is drawn by our own **synchronous,
deterministic, DOM-free orthogonal router**: candidate shapes, port slots, A* fallback, nudging
([architecture/layout.md](../architecture/layout.md#router-router)). It has a budget of
< 16ms for 100 nodes / 150 edges.

## Consequences

- Lines re-route on every drag frame; pinned and moved nodes are routed around.
- Line quality is ours to own and test ([0013](0013-line-quality-rules-and-manual-routes.md)).
- The router is the most complex code in the repo; it has a specialist agent and a visual check.

## Alternatives considered

- **ELK orthogonal routing:** no live re-routing, ignores our pinned positions.
- **libavoid-js (WASM):** strong obstacle avoidance; kept as a later option if our router stops
  being good enough.

# 0013. Line quality rules, and hand-routed lines

- **Status:** accepted
- **Date:** 2026-10-17 (rules, phase 11); 2026-10-18 (manual lines, phase 13)
- **Where:** spec 001 backlog B1, B2, B4; `layout/src/router/`, `layout/src/edge-edit.ts`, `engine/tests/quality.test.ts`

## Context

Review of the examples showed the worst PlantUML-style artefacts: an arrowhead sitting right on a
bend, and lines running exactly on a container border. And when a line takes a bad path, users
could only move nodes around it.

## Decision

- Every arrow end (and start) keeps a straight run of at least arrowhead + 12px (`ARROW_STUB`);
  the router prefers another side over a too-short stub, and render clamps corner radii so they
  never eat it.
- A line never runs along a container border: it crosses it or stays `BORDER_GAP` (10px) away.
- Routes are orthogonal.
- Users can **move lines**: drag a segment sideways (stored as `manual` points), or drag an end
  to another side (stored as `sourcePort`/`targetPort`, then routed automatically). Manual routes
  are kept and only their ends re-snapped when a connected node moves; "reset route" undoes it;
  manual lines get a marker.

## Consequences

- These are tested properties on every example and a 100-node graph, not just visual goals.
- Manual routes are layout data; they never touch the code.

## Alternatives considered

- **Visual review only:** regressions slip in with router changes.

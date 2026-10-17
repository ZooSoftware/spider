---
paths:
  - "packages/layout/**"
  - "packages/render/**"
---

# Layout, router, render

- **A user edit never moves other nodes** (no cascades). Existing nodes keep x/y in incremental
  layout; overlaps are reported (`layout/overlaps-container`), not resolved.
- Containers always fit their children; `minW`/`minH` only add room.
- ELK only places nodes. All lines come from our router (`router.ts`): synchronous,
  deterministic, DOM-free; ~12ms for 100 nodes / 150 edges — keep it under 16ms.
- Line invariants (tested in `render/src/quality.test.ts` on every example):
  arrow ends keep a straight run ≥ `ARROW_STUB`; no segment runs along a container border
  (`BORDER_GAP`); routes are orthogonal; `manual` routes are kept and only re-snapped.
- Layout file changes are contract changes (`layout-file.ts`): additive only, update
  `layout-io.ts` parse + serialize and the round-trip test.
- Router or render changes: also look at the result — use the `visual-check` skill.

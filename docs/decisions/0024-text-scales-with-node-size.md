# 0024. Text scales with node size; nothing is stored

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 backlog B3, phase 9; `render/src/render.ts`, `render/src/svg.ts`

## Context

Resizing a node changed the box but not the label, so a big box had small text and a small box
ellipsized early.

## Decision

Render derives a content scale from the node's size against its kind's default size:
`scale = clamp(min(w / w0, h / h0), 0.75, 2)`, applied to font size, line height, icon size and
padding; wrapping uses the scaled font. Nothing new is stored in the layout file.

## Consequences

- Resizing visibly scales the content, with no format change.
- A big box with normal-size text isn't possible yet.

## Alternatives considered

- **An explicit `fontScale` in the layout entry:** possible later if users want big boxes with
  normal text (additive format change).

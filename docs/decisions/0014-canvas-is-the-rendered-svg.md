# 0014. The canvas is the rendered SVG plus a small interaction layer

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** prototype default (spec 001); `render`, `editor/src/canvas.ts`, `overlay.ts`

## Context

The original plan was React + xyflow for the canvas. That means a second renderer next to the
SVG export, which drifts from what you export, plus a framework for a small amount of interaction.

## Decision

The editor shows the **same SVG** `renderSvg` produces for export (with `interactive: true`
adding `data-id`s and hit strokes), plus an overlay for handles and markers. Drag, select,
connect, resize and zoom are our own small interaction layer. No React, no xyflow.

## Consequences

- What you see is exactly what you export.
- The SVG is re-rendered on every frame, so the interaction code can't rely on element identity
  between events or on native `dblclick`.
- Revisit xyflow (or similar) only if interaction gets complex.

## Alternatives considered

- **React + xyflow / tldraw:** richer interactions out of the box, a second renderer and a framework.

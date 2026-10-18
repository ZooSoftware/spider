# Render

`packages/render`: `renderSvg(model, profile, layout, { interactive? })` → a standalone SVG
string. Pure; the pipeline that produces the layout lives in `engine`.

| File | Job |
|---|---|
| `render.ts` | containers, nodes, icons, labels, edges, arrowheads, edge labels, theme |
| `shapes.ts` | outlines for `rect`, `rounded`, `cylinder`, `circle`, `hexagon`, `person`, `cloud`, `queue`, `diamond`, `parallelogram`; each fills its box exactly |
| `svg.ts` | escaping, number formatting, text measurement and wrapping, icon embedding |

- **One renderer** for export and the canvas ([0014](../decisions/0014-canvas-is-the-rendered-svg.md)).
  `interactive: true` adds `data-id` attributes and wide invisible hit strokes on lines for
  the editor; export is the same SVG without them.
- **Edge endpoints**: the router ends lines on the node's **box** boundary; render then slides
  each end along its last segment onto the shape's outline (`snapToOutline`: diamond,
  parallelogram, hexagon, circle/ellipse…), so lines visually touch the shape. The stored
  layout keeps the box points.
- **Corner radii** on lines are clamped so they never cut into the arrow stub.
- **Text scales with node size** ([0024](../decisions/0024-text-scales-with-node-size.md)):
  `scale = clamp(min(w / w0, h / h0), 0.75, 2)` against the kind's default size, applied to
  font size, line height, icon size and padding; wrapping uses the scaled font.
- **Unknown kinds** render as a generic box with their kind and label ([0007](../decisions/0007-unknown-kinds-kept-losslessly.md)).
- Icons are already sanitized by the loader; render only embeds them.

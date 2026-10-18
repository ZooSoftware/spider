# SVG

Diagrams are rendered as **plain SVG strings**, with no DOM and no library. The same output
is the CLI export and the editor canvas ([0014](../decisions/0014-canvas-is-the-rendered-svg.md)).

| Topic | How | Where |
|---|---|---|
| Rendering | string building with escaping and number formatting | `render/src/render.ts`, `svg.ts` |
| Shapes | each shape fills its box exactly, so router endpoints on the box boundary touch it | `render/src/shapes.ts` |
| Text | rough width without a DOM (average glyph ≈ 0.56em, wide glyphs count more), wrapped to the node width, scaled with node size ([0024](../decisions/0024-text-scales-with-node-size.md)) | `render/src/svg.ts` |
| Icons | profile SVGs inlined after sanitizing; 24×24 line icons using `currentColor` | `profiles/src/sanitize.ts` |
| Editor hit testing | `renderSvg(..., { interactive: true })` adds `data-id` attributes and wide invisible strokes on lines | `render`, `editor/src/canvas.ts` |
| PNG | CLI: `spider build --png` shells out to `rsvg-convert` (2×), falling back to ImageMagick `magick`; neither is a dependency, the user installs one. Editor: drawn to a `<canvas>` at 2× in the browser | `cli/src/main.ts`, `editor/src/export.ts` |

## Sanitizing user SVG

Every icon from a profile goes through `sanitizeSvg` before it is rendered. It needs no DOM:
a small tokenizer rebuilds every tag from an **allowlist** of SVG elements and attributes.
Dangerous elements (`script`, `foreignObject`, `style`, animation, embeds) are dropped with
their subtree; unknown elements lose their tag but keep their children; event handlers,
`javascript:` URLs and external references are removed; only `#…` references and raster
`data:image` URLs survive.

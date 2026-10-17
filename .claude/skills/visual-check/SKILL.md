---
name: visual-check
description: Render the example diagrams with a fresh layout to PNG and inspect them. Use after any change to layout, router, render, shapes, themes or profiles, or when the user reports a diagram that looks wrong.
---

# Visual check of rendered diagrams

Tests catch invariants; this catches what looks wrong (overlaps, arrows on bends, lines on
borders, cramped labels, odd placement).

1. Copy the examples to a scratch folder so the user's `examples/*.layout.json` are untouched:
   ```sh
   S=<scratchpad>/visual && rm -rf $S && mkdir -p $S && cp -r examples/*.spd examples/profiles $S/
   ```
2. Build each with a fresh layout and PNG (needs ImageMagick or rsvg-convert):
   ```sh
   for f in $S/*.spd; do bun run spider build "$f" --png --reset 2>&1 | tail -1; done
   ```
   Every line must end with `0 error(s)`.
3. Read each PNG with the Read tool. For large ones, crop the area of interest with
   `magick in.png -crop WxH+X+Y out.png` and read the crop.
4. Check for: lines through boxes; parallel lines on top of each other; an arrowhead right
   after a bend; a line running along a container border; labels over lines or boxes;
   containers covering nodes that aren't inside them; text overflowing a shape.
5. For layout stability: append a node + edge to a copy, rebuild without `--reset`, and
   confirm existing node x/y in the `.layout.json` did not change.
6. Report what you saw (with the PNG paths). New problems that are out of scope go to
   `BACKLOG.md` only if the user agrees.

# Backlog

Issues found during review that are not part of the current phase. Add items here only
when a real diagram shows the problem. Priority: **high / medium / low**.

---

## B1 — Arrowhead right after a bend (medium)

**Problem:** when a line bends close to its target, the bend and the arrowhead land on the
same spot: the last straight segment is shorter than the arrowhead, so the arrow appears
at the corner, with no straight stretch of line before it. This is one of the worst
visual problems in PlantUML and should be handled well here.

Seen in `examples/checkout.spd`: `order -> events` (dashed, "OrderPlaced") runs down,
then turns right only a few pixels before the arrowhead at `Order Events`.

**Expected:** every line ends with a straight segment, in the direction of the port, that
is clearly longer than the arrowhead (proposal: at least arrowhead length + 12px ≈ 20px).
The bend before it must not eat into that segment (rounded corners included).

**Approach ideas:**
- Router: treat the target stub (and the source stub) as a required minimum-length final
  segment when choosing L/Z/U shapes and in the A* fallback; reject or penalize candidates
  that violate it.
- The nudging and port-sliding passes in `layout/src/router.ts` must not shorten the
  final segment below the minimum.
- Render: rounded-corner radius must be clamped so it never cuts into the last segment.
- If nodes are too close for the minimum, prefer another side/port over a short stub.

**Done when:** a router test asserts the minimum final-segment length for every routed
edge in the examples and the 100-node test graph; the checkout example looks clean.

---

## B2 — Lines running along container borders (low)

**Problem:** lines can run exactly on top of a container border, so the line and the
border overlap and are hard to tell apart.

Seen in `examples/checkout.spd` (`order -> stripe` along the bottom of "Production
VPC") and `examples/platform.spd` (`payment -> stripe` along the bottom of "Payments
Domain").

**Expected:** a line either crosses a container border (roughly perpendicular) or stays
clearly away from it (≥ 8–10px), never runs along it.

**Approach ideas:**
- Router: add container borders as "soft" obstacles: segments parallel to and within a
  margin of a border get a cost penalty (crossing stays allowed).
- Or nudge segments that lie on a border inwards/outwards in the nudging pass.

**Done when:** a router test asserts no segment runs parallel to a container border
within the margin; both examples look clean.

---

## B3 — Text should scale when a node is resized (medium)

**Problem:** resizing a node in the editor changes the box, but the label keeps its font
size, so a big box has small text (and a small box overflows/ellipsizes early).

**Expected:** label (and subtitle, icon) scale with the node size.

**Approach ideas:**
- Derive a scale from the node's size vs. its kind's default size:
  `scale = clamp(min(w / w0, h / h0), 0.75, 2)`; apply to font size, line height,
  icon size and paddings in `render/src/render.ts`. Nothing new stored in the layout file.
- Keep word wrapping based on the scaled font and the new width.
- Consider an explicit `fontScale` in the layout entry later, if users want big boxes with
  normal text.

**Done when:** render test: a node at 2× default size renders a larger font than at 1×;
resizing in the editor visibly scales the text.

---

## B4 — Move lines, not only nodes (high)

**Problem:** only nodes can be moved. When lines overlap or take a bad path, the user has
no way to fix a single line; they can only move nodes around it.

**Expected:** like draw.io, the user can grab a line segment and drag it (perpendicular to
the segment) to re-route it, and drag a line end along a node side to change the port.

**Approach ideas:**
- Editor: hit-test segments (wide invisible stroke), drag moves the segment and adjusts the
  two neighbouring segments so the route stays orthogonal; add a bend if needed.
- Store as `manual: true` + `points` in the layout file (already supported by the router:
  manual edges keep their points and only re-snap endpoints).
- Dragging an endpoint along a side stores `sourcePort` / `targetPort` (and offset).
- When a connected node moves later: keep the manual interior points, fix only the
  segments next to the moved node so the line stays orthogonal.
- "Reset route" action (per edge) to go back to automatic routing; manual edges get a
  small marker like pinned nodes.

**Done when:** in the editor, a segment can be dragged and the new route persists across
reload and rebuild; moving a connected node keeps the line orthogonal; reset route works.

---

## B5 — Resizable code panel (low)

**Problem:** the split between code and canvas is fixed (38%).

**Expected:** drag the divider to resize; double-click (or a button) to collapse/expand the
code panel.

**Approach ideas:** a divider element between the panes updating the grid column width;
remember the width in `localStorage` (per-viewer convenience); refit nothing, the canvas
keeps its camera.

**Done when:** divider drags smoothly, width survives reload, collapse works.

---

## B6 — Undo / redo across code and canvas (high)

**Problem:** CodeMirror has undo for typing, but canvas edits (drag, resize, unpin, reset
layout) cannot be undone, and in Phase 6 canvas edits will also change the code, so the
two histories must not get out of sync.

**Expected:** `Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`) undo/redo the last user action,
whether it was typed in the code or done on the canvas; one drag = one undo step; a burst
of typing = one undo step.

**Approach ideas:**
- One app-level history of snapshots `{ text, layout, selection }`, pushed per user action
  (drag end, resize end, unpin, reset, debounced typing burst, Phase 6 structural edits).
- Route CodeMirror's undo keys to the app history (or keep CM history for text-only and
  merge via transactions), so there is only one source of truth.
- Restoring a snapshot writes both files through the normal save path.
- Cap history size (e.g. 200 steps); history lives in memory for the session.
- Later: named versions / snapshots (possibly via git) are a separate feature.

**Done when:** a sequence of type → drag → resize → type can be undone step by step and
redone, with files on disk matching each step.

---

## B7 — Zoom slider (low)

**Problem:** wheel zoom steps feel too big or too small, and there is no way to see or set
the current zoom level.

**Expected:** a zoom control in the canvas corner: slider (e.g. 10%–400%), current
percentage, `−` / `+` buttons, "100%" and "Fit". Wheel zoom stays, with a gentler step.

**Approach ideas:** zoom = canvas pixel width / camera width; the slider sets the camera
width around the view center; keep it in sync when wheel-zooming. Optional: remember zoom
per file in `localStorage`.

**Done when:** slider and wheel stay in sync; 100% shows diagram units 1:1 on screen.

---

## B8 — Container boundaries cover nodes that are not inside them (high, bug)

**Problem:** a container (e.g. "Production VPC") can end up drawn over nodes that are not
its children, so they look like they are inside the boundary when they are not.

**Causes found** (`layout/src/geometry.ts` `fitContainers`, `layout/src/layout.ts`):
1. A **pinned container only grows, never shrinks**: once a container has been dragged
   (and so pinned), moving its children back leaves it oversized.
2. Fitting a container to its children **ignores non-member nodes**: when a child is
   dragged far out, the container grows over unrelated nodes and nothing resolves the
   overlap (existing nodes never move).
3. Containers have **no resize handle**, so the user can't fix it by hand.
4. Dragging a node visually into a container doesn't make it a child (membership is code,
   see Phase 6).

**Expected:** a container's box always reflects its real children: it fits its content
automatically, and never covers a node that is not inside it.

**Approach ideas:**
- Always fit containers exactly to their children (drop "pinned only grows"); dragging a
  container just moves its subtree.
- Optional manual size: a container resize handle stores a *minimum* size (the box is
  `max(fit, min size)`), never smaller than its content.
- After a user action, if a container overlaps a non-member node: move unpinned non-member
  nodes out to the nearest free spot; for pinned ones, show a warning outline instead of
  moving them.
- Phase 6: dropping a node onto a container offers to move it into that container's block
  in the code (and dragging it out moves it out).

**Done when:** layout test: after any drag/resize sequence, no non-member node box
intersects a container box; a container shrinks back when its children move closer.

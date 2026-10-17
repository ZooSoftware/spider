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

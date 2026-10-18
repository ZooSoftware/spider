# 0025. Simple and compact first: fix the pains, don't become draw.io

- **Status:** accepted. **The guiding principle: it outranks every other decision.**
- **Date:** 2026-10-18
- **Where:** the whole project; checked when a spec is planned and when a phase ships

## Context

Mermaid and PlantUML have well-known problems: overlapping lines, layout recomputed on every
compile, no control after compile. They keep them on purpose, because what users value most is
a **simple, fast tool**: write a few lines, get a diagram, configure nothing. draw.io solves
every layout problem by giving full freedom, and pays with slowness, verbose files and diagrams
nobody can review or generate.

Spider sits between them on purpose: Mermaid's simplicity, plus fixes for a few specific pains.
Each feature that adds freedom moves us towards draw.io, so the pull has to be resisted on
every feature, not only once.

## Decision

Spider stays **simple and compact**. We fix specific pains (layout that stays put, lines you can
nudge, canvas edits that flow back to code, good default routing) **without** making the user
configure more or giving them draw.io-style freedom.

Every feature must pass the **simplicity test** before it is planned:

1. **Zero config by default.** A diagram with no layout file, no options and only a `use` line
   looks good. A feature that only works after configuration is not done.
2. **The code stays the short path.** Nothing requires geometry, styling or layout options in
   the `.spd`. The model stays `kind id "label"` and `a -> b`.
3. **Fix the cause, don't add a knob.** Prefer better automatic behaviour over a new option.
   A new setting needs a reason why no good default exists.
4. **Escape hatches are small, local and resettable.** Manual control (pin, move a line, pick a
   port, a minimum size) touches one element, lives in the layout file, and has a reset.
5. **Freedom lives in profiles, not in diagrams.** Shapes, colours, icons and styles are chosen
   per kind by the profile author once, not per element by every user.
6. **Small surface.** No new grammar unless the problem can't be solved without it; few
   dependencies; small code. Ask "can we remove something instead?"
7. **If it smells like draw.io, it's out.** Free-form shapes, free text boxes, per-element
   colours and fonts, layers, arbitrary drawing tools, pixel styling panels.

When a feature fails a point, simplify it, make it automatic, move it into a profile, or
drop it. When in doubt, ask the user before building.

## Consequences

- Some diagrams won't look exactly as someone would draw them by hand; that's accepted.
- Specs state how each feature passes the test, and reviews push back on scope creep.
- The editor stays a thin layer over the code, not a drawing app.
- Earlier decisions follow from this one: one generic grammar ([0005](0005-one-generic-grammar.md)),
  declarative profiles ([0021](0021-profiles-are-declarative.md)), no cascades
  ([0011](0011-user-edits-never-move-other-nodes.md)), text scaling with nothing stored
  ([0024](0024-text-scales-with-node-size.md)).

## Alternatives considered

- **Full freedom (draw.io):** every problem solvable, but slow, verbose, not AI-friendly.
- **No control at all (Mermaid):** simplest, but keeps the pains that motivated spider.

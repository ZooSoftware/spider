# Spider docs

Spider is diagram-as-code with a **reverse flow**: code → diagram, and diagram edits → code.
These docs are the source of truth for what spider is, how it is built and why.
The user guide (install, CLI, editor) is the top-level [README](../README.md).

> **The most important rule: simple and compact first** ([0025](decisions/0025-simple-and-compact-first.md)).
> Spider keeps the simplicity of Mermaid and PlantUML (write a few lines, get a diagram,
> configure nothing) and fixes only their specific pains: layout that stays put, lines you can
> nudge, edits that flow back to the code. It never becomes a free-form editor like draw.io.
> Every feature must pass the simplicity test in that record.

| Folder | Answers | Start with |
|---|---|---|
| [techs/](techs/README.md) | What do we build with, and how do we use each piece? | the stack table |
| [architecture/](architecture/README.md) | How is the code structured, and how does data flow through it? | the package map |
| [reference/](reference/README.md) | What exactly is valid: grammar, `profile.yaml`, layout file, diagnostic codes? | [grammar](reference/grammar.md) |
| [decisions/](decisions/README.md) | Why is it this way? One record per decision, with the alternatives | the index |
| [roadmap.md](roadmap.md) | What is done, what is next, what is out of scope, what is still open? | — |

Plans and work in progress live in [`spec/`](../spec/README.md), not here.

## Where a new fact goes

- A **decision** that shapes the project (a rule, a trade-off, a format choice): a new
  record in `decisions/` (copy the [template](decisions/template.md)). Never edit an
  accepted record's decision; supersede it with a new one.
- How something **works** today: the matching page in `architecture/`.
- A **format** change (grammar, profile schema, layout file, a new diagnostic code):
  `reference/`, in the same commit as the code.
- A new **dependency** or a change in how we use one: `techs/`.
- An **open question** or a new "later" item: `roadmap.md`.
- A rule for whoever edits the code (human or AI): `CLAUDE.md` / `.claude/rules/`, linking
  to the decision behind it.

Docs describe the code as it is. If they disagree, the code wins and the doc is a bug.

---

## The problem

| Approach | Pros | Cons |
|---|---|---|
| Manual (draw.io, etc.) | Full control | Slow; no code, hard to diff and review; AI can't generate it well |
| draw.io generators | Output is editable | Generated XML is verbose; edits don't flow back to the source |
| Mermaid / PlantUML | Text-based, AI-friendly, diffable | Lines overlap; layout is recomputed on every compile; **no control after compile**; PlantUML needs a JVM |

**Goal:** keep the code → diagram flow and its AI-friendliness, and add **diagram → code**,
so a compiled diagram can be edited visually and the edits are saved back to the source.

## The approach

1. **Two parts per diagram** ([0001](decisions/0001-model-and-layout-are-separate.md)): the
   *model* (what exists, written by people and AI, no coordinates) in `diagram.spd`, and the
   *layout* (where things are, owned by the editor) in `diagram.spd.layout.json`.
   Stable IDs link them.
2. **A small space per diagram type**: a *profile* ([0006](decisions/0006-built-in-types-are-profiles.md))
   declares the node kinds, edge kinds, shapes, icons and rules. A smaller, well-defined space
   makes round-tripping, validation, layout quality and AI generation work.
3. **One generic grammar** ([0005](decisions/0005-one-generic-grammar.md)): profiles give
   meaning to kinds, they never change the syntax.
4. **Write-back that keeps the user's text** ([0009](decisions/0009-write-back-is-text-splices.md)):
   canvas edits become small text splices; comments, order and formatting survive.
5. **Layout you can trust** ([0011](decisions/0011-user-edits-never-move-other-nodes.md)):
   pinned nodes never move, existing nodes stay where they are, a user edit never moves other nodes.

```
            ┌──────── structural edits (connect, delete, rename, add) ───────┐
            ▼                                                                 │
  diagram.spd (model) ──parse──► Model (stable IDs) ──► layout + route ──► Canvas (SVG)
                                       ▲                                      │
                                       │                                      │
  diagram.spd.layout.json ─────merge───┘◄──── geometric edits (drag, resize, ─┘
  (positions, routes, pinned)                  move a line, change a port)
```

## Prior art

- **Structurizr:** DSL model + separately saved layout JSON + UI dragging. Closest existing example.
- **D2 (+ TALA):** good DSL and layout; no reverse flow.
- **Eraser, Ilograph:** commercial diagram-as-code.
- **Building blocks considered:** ELK.js, libavoid (Adaptagrams), xyflow, tldraw, Lezer, CodeMirror.

**Our difference:** a small AI-first grammar, incremental layout with pinning, real two-way
editing that preserves formatting, and user-defined profiles.

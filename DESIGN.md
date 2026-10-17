# Spider — Design Draft

> Status: draft v0 · 2026-10-17
> Diagram-as-code with a **reverse flow**: code → diagram, and diagram edits → code.

---

## 1. Problem

| Approach | Pros | Cons |
|---|---|---|
| Manual (draw.io, etc.) | Full control | Slow; no code, hard to diff/review; AI can't generate it well |
| draw.io generators | Output is editable | Generated XML is verbose; edits don't flow back to the source |
| Mermaid / PlantUML | Text-based, AI-friendly, diffable | Lines overlap; layout is recomputed on every compile; **no control after compile**; PlantUML needs a JVM |

**Goal:** keep the code → diagram flow and its AI-friendliness, and add **diagram → code**, so a compiled diagram can be edited visually and the edits are saved back to the source.

**Approach:** limit the space of shapes and rules per diagram type (a *profile*). A smaller, well-defined space makes round-tripping, validation, layout quality and AI generation work.

---

## 2. Core model: two parts

A diagram source has **two parts**, and they are kept separate on purpose:

1. **Model (semantic)**: what exists.
   - Objects (nodes), their kind, label, props
   - Containers / groups
   - Relationships (edges), their kind, label
   - Written by humans and AI. Contains **no coordinates**.
2. **Layout (geometric)**: where things are.
   - Node positions, sizes
   - Edge waypoints, port sides
   - `pinned` flags
   - Owned by the editor. The AI ignores it.

The two parts are linked by **stable IDs**. Every node and edge has an ID that survives edits.

### Invariants
- The **model is the source of truth for what exists.** Layout only describes elements that exist in the model.
- A model element with no layout entry is **auto-placed**.
- A layout entry whose ID is not in the model is an **orphan** and gets cleaned up (the policy is open, see §9).

### Example

```
use base/architecture

zone vpc "VPC" {
  service api   "API Gateway"
  service order "Order Svc"
  db      orders_db "Orders DB"
}
external stripe "Stripe"

api   -> order     : "REST"
order -> orders_db
order -> stripe    : "charge"

layout {                         # editor-owned
  api   @ 40,120 pinned
  order @ 260,120
  order->stripe via 420,120 420,40
}
```

Layout lives either **inline** (a `layout {}` block at the end of the file) or in a **sidecar file** (`diagram.spd.layout.json`). See §9.

---

## 3. Two-way flow

```
            ┌──────── semantic edits (add node, connect, rename) ────────┐
            ▼                                                             │
  diagram.spd (model) ──parse──► Model (stable IDs) ──► Layout engine ──► Canvas
            ▲                          ▲                                   │
            │                          │                                   │
  layout (positions, waypoints, ──merge┘◄──── geometric edits (drag, ──────┘
  ports, pinned)                               reroute, resize)
```

### 3.1 Diagram → code (edit routing)

| Edit on the canvas | Model | Layout |
|---|---|---|
| Move / resize a node, bend a line, change a port side | — | ✅ |
| Add a node | ✅ | ✅ (its position) |
| Draw a new line / reconnect a line end | ✅ | ✅ (new or reset waypoints) |
| Delete a node or line | ✅ | ✅ (remove entries) |
| Rename a label | ✅ | — |
| Rename an ID | ✅ | ✅ (rekey entries) |
| Change a prop / kind | ✅ | — (may trigger re-layout of that node) |

**Model write-back preserves the user's text:** edits are applied as small, targeted changes on a syntax tree that keeps comments, ordering and formatting. The whole file is never regenerated from the model.

### 3.2 Code → diagram (incremental layout)

- After a model change, layout runs **incrementally**:
  - Pinned elements never move.
  - Existing unpinned elements stay close to where they were.
  - New elements get placed around them.
- A "reset layout" command clears the layout and runs a fresh auto layout.

### 3.3 Line overlap

Mostly a routing problem:
- **Ports:** edges attach to a node side or slot, not its center.
- **Orthogonal routing that avoids obstacles:** ELK orthogonal routing, then libavoid if needed.
- **Manual override:** a manually routed edge stores its waypoints and stops being auto-routed.

---

## 4. Customization: profiles

Diagram types are **not hard-coded**. A **profile** defines the allowed space for a diagram type, and users and developers can create their own with their own assets and rules.

**Rule:** built-in diagram types use exactly the same profile mechanism as user profiles.

### 4.1 Profile package

```
profiles/aws/
  profile.yaml      # node kinds, edge kinds, rules, layout hints
  icons/*.svg       # user's assets
  theme.yaml        # colors, fonts, strokes (optional)
  plugin.ts         # optional code extension (opt-in, sandboxed)
```

```yaml
name: aws
version: 1.2.0
extends: base/architecture        # inherit, then override

nodes:
  lambda:
    icon: icons/lambda.svg
    size: [64, 64]
    label: below
    props: { runtime: string, memory: number }
    ports: [left, right]
  rds:
    icon: icons/rds.svg
    layout: { layer: last }        # layout hint
  vpc:
    container: true
    allows: [lambda, rds, ec2]     # containment rule

edges:
  calls: { style: solid,  arrow: end }
  async: { style: dashed, arrow: end, allowed: [lambda -> sqs] }

rules:
  - forbid: external -> rds
    message: "DB must not be exposed directly"
```

Usage in a diagram:

```
use aws@1.2
use mycompany/k8s as k8s

vpc main { lambda fn "Checkout"  rds db "Orders" }
fn -> db : calls
k8s.pod worker
```

### 4.2 Principles

1. **Declarative first.** YAML covers icons, shapes, ports, edge styles, containment, validation and layout hints (around 90% of needs).
2. **Code as an escape hatch.** An optional `plugin.ts` can add custom validators, renderers or layout strategies. It runs sandboxed (Web Worker) and only when the user explicitly enables it.
3. **Inheritance and namespaces.** `extends` reuses a base profile. `alias.kind` avoids name clashes when several profiles share one diagram.
4. **Versioning.** Diagrams pin a profile version, and a lockfile records the exact resolved version. Sources: local folder, npm, git, URL.
5. **Missing profiles are safe for the round trip.** An unknown kind or missing profile renders as a generic box, and **the data is kept untouched**. Write-back never drops what it doesn't understand.
6. **Profiles feed the AI automatically.** Each profile generates a short cheat sheet (kinds, props, allowed edges, an example) to put in an LLM prompt or expose through an MCP server.
7. **Profiles have a versioned schema** (JSON Schema / Zod), which gives editor autocomplete and validation.
8. **Assets are sanitized.** Scripts and external references are removed from SVGs.

### 4.3 One grammar

The syntax is **generic** (`kind id "label" { props }`, `a -> b : kind "label"`). Profiles give meaning to kinds; they **do not change the grammar**. This keeps parsing, write-back and AI generation simple.

### 4.4 Grammar v0

Implemented in `packages/core` (`lexer.ts`, `parser.ts`). Whitespace and newlines are not significant, and several statements may share a line, with one exception: the token that must follow `use`, `@`, `as`, `->`, `:`, `.` or a node kind has to be on the same line. That way a half-typed line doesn't swallow the statement on the next line.

```
file    := stmt*
stmt    := use | edge | node                 # inside blocks: also prop
use     := 'use' profile ('@' version)? ('as' IDENT)?
profile := IDENT ('/' IDENT)*
version := [0-9A-Za-z.-]+                    # no spaces, e.g. 1.2.0-beta.1
edge    := IDENT '->' IDENT (':' kind?)? STRING?      # IDENT followed by '->'; kind may be namespaced
node    := kind IDENT STRING? block?
kind    := IDENT ('.' IDENT)?                # namespaced: k8s.pod
block   := '{' (prop | stmt)* '}'
prop    := IDENT ':' value                   # IDENT followed by ':'
value   := STRING | NUMBER | 'true' | 'false'
IDENT   := [A-Za-z_][A-Za-z0-9_]*
NUMBER  := -?[0-9]+(.[0-9]+)?
STRING  := '"' ... '"'                       # single line; escapes \" \\ \n
comment := '#' to end of line
```

- **Keywords are positional.** `use` is a keyword only at the start of a statement that isn't an edge or prop (`use -> x` is an edge). `as` is a keyword only inside `use`.
- **Edges.** In `a -> b : "REST"` the edge has a label and no kind. Edge ids are `a->b`, then `a->b#2`, and so on, in source order. Edges inside blocks are global.
- **Containers.** A node is a container when its block holds at least one child node. A block may mix props and statements.
- **Model diagnostics:**
  - duplicate node id: error, the first node is kept
  - edge to an unknown id: error, the edge is kept
  - duplicate prop key: warning, the last value wins
- **Losslessness.** Every token carries leading trivia and trailing trivia. Trailing trivia runs up to and including the first line break. `print(parse(text)) === text` holds for any input, including invalid input.
- **Errors.** Parse errors never throw. Skipped tokens become `Error` items, and parsing resumes at the next identifier, `}` or the end of the file.

---

## 5. Tech stack

**TypeScript end to end.** No JVM and no server. The same core runs in the browser, the CLI and a VS Code extension.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | TypeScript on Bun | One codebase everywhere; Bun runs the CLI, tests and dev server |
| Parser | Hand-written recursive descent (or Lezer) | Small grammar, good errors, a syntax tree that keeps formatting for write-back |
| Layout | ELK.js in a Web Worker | Layered layout, ports, groups, constraints. ~1.5 MB (compiled from Java), runs without a JVM |
| Routing | ELK orthogonal routing → libavoid-js (WASM) later | Avoids overlaps |
| Rendering | Plain SVG from the core | Shared by CLI export and the editor; PNG/PDF via conversion |
| Canvas | React + xyflow (React Flow) | Drag, select, connect and zoom built in |
| Code editor | CodeMirror 6 | Lighter than Monaco |
| Schema | JSON Schema / Zod | For profiles |
| Build | Bun workspaces + Bun bundler | `bun test` for tests |

**Possible later step:** if speed requires it, port `core`/`layout` to Rust compiled to WASM. Keep the TS interfaces clean so the swap is possible. Not for v1.

### Package layout

```
packages/
  core/            # parser, syntax tree, model, write-back, validation (no DOM)
  profile-schema/  # profile format schema + types
  profiles/        # loader/resolver + built-in profiles (base/architecture, ...)
  layout/          # ELK adapter, incremental + pinned layout, routing
  render/          # model + layout + profile → SVG
  cli/             # spider build diagram.spd -o out.svg
  editor/          # web app: CodeMirror ⇄ canvas two-way sync
```

**Rule:** `core` has no DOM, no React and no knowledge of specific diagram types.

---

## 6. MVP scope

1. One profile: `base/architecture` (~6 node kinds + zone/group).
2. Pipeline: DSL → model → ELK layout → SVG, through the CLI.
3. Web editor: drag + pin → saved to layout; stable across recompiles.
4. One model write-back: drawing a connection on the canvas inserts `a -> b` into the code.
5. Profile loading from a local folder (proves the customization path).
6. Export: SVG / PNG.

## 7. Later

- Full write-back (add/delete/rename from the canvas)
- libavoid routing
- More profiles: flowchart, C4, network
- VS Code extension, MCP server for AI
- draw.io XML export as an escape hatch
- Code plugins (`plugin.ts`)
- Profile sources: npm / git / URL + lockfile

## 8. Out of scope (v1)

- Per-profile custom syntax
- Public profile registry / marketplace
- Sequence diagrams (their layout is already fixed by message order; little benefit)
- Real-time multi-user collaboration

---

## 9. Open questions

1. **Layout location:** inline `layout {}` block vs. sidecar file? Inline means one file to share; sidecar keeps code diffs clean.
2. **ID strategy:** require explicit IDs, or derive them from labels? What happens to layout entries when an ID is renamed in code (rather than in the editor)?
3. **Orphan policy:** drop orphan layout entries immediately, or keep them for N saves (to survive cut/paste in code)?
4. **Edge IDs:** `a->b` is ambiguous when there are several edges between the same nodes. Use an index (`a->b#2`) or an explicit name?
5. **Conflicts:** behavior when code and canvas are edited at the same time (last write wins vs. merge).
6. **File extension / project name:** `.spd`?
7. **Layout quality:** is ELK good enough for architecture diagrams, or do we need custom hints per profile early on?

## 10. Prior art

- **Structurizr:** DSL model + separately saved layout JSON + UI dragging. Closest existing example.
- **D2 (+ TALA):** good DSL and layout; no reverse flow.
- **Eraser, Ilograph:** commercial diagram-as-code.
- **Building blocks:** ELK.js, libavoid (Adaptagrams), xyflow, tldraw, Lezer, CodeMirror.

**Our difference:** a small AI-first grammar, incremental layout with pinning, real two-way editing that preserves formatting, and user-defined profiles.

---

## 11. Decisions made during the prototype

- **Layout sidecar** (`<file>.spd.layout.json`), explicit node ids, edge ids `a->b`, `a->b#2`.
- **Placement vs. routing:** ELK only places nodes; our own synchronous orthogonal router draws
  every line (needed for live re-routing while dragging and for pinned/moved nodes).
- **A user edit never moves other nodes.** Overlaps are shown (warning outline +
  `layout/overlaps-container`), not auto-resolved, to avoid cascades.
- **Containers** always fit their real children; a resize handle only sets a minimum size.
- **Lines:** every arrow end keeps a straight run of arrowhead + 12px; lines never run along
  container borders. Hand-routed lines are stored as `manual` points; dragging a line end to
  another side stores `sourcePort`/`targetPort` and routes automatically.
- **Write-back** edits go through the code editor as normal transactions, so they are visible,
  saved and undoable. **One history** of `{ text, layout }` snapshots covers code and canvas.
- **Membership is code:** dropping a node onto a container moves its statement into that block.
- **Editor runs the pipeline in the browser**; the server (127.0.0.1 only) does file IO,
  profile loading and pushes external edits. Reads that overlap a save are discarded.
- **Namespaced kinds** for nodes and edges (`k8s.pod`, `: k8s.mounts`) come from `use … as k8s`.


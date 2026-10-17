# Spider

Diagram-as-code you can also edit as a diagram. Write a small, AI-friendly text file, get a
clean diagram with non-overlapping lines, then drag, resize, connect and rename on the canvas:
every change is written back to the code (or to a layout file) and survives the next compile.

```
use base/architecture

user customer "Customer"
zone vpc "Production VPC" {
  service api   "API Gateway"   { tech: "Kong" }
  service order "Order Service" { tech: "Go" }
  db      orders_db "Orders DB"
}
external stripe "Stripe"

customer -> api : "HTTPS"
api -> order
order -> orders_db : data
order -> stripe : "charge"
```

## Quick start

Requires [Bun](https://bun.sh).

```sh
bun install
bun run spider dev examples/checkout.spd       # editor on http://127.0.0.1:4321
bun run spider build examples/checkout.spd --png
```

## Two files per diagram

| File | Holds | Who writes it |
|---|---|---|
| `diagram.spd` | what exists: nodes, containers, lines, labels, props | you, AI, canvas edits that change meaning |
| `diagram.spd.layout.json` | where things are: positions, sizes, pinned nodes, manual line routes | the editor and `spider build` |

Both are plain text and diff well. Delete the layout file (or use `--reset`) for a fresh layout.

## CLI

```
spider build <file.spd> [-o out.svg] [--png] [--reset]   render SVG (+PNG), update the layout file
spider check <file.spd>                                   diagnostics only (exit 1 on errors)
spider layout <file.spd> [--reset]                        update the layout file only
spider dev <file.spd> [--port 4321]                       open the two-way editor
spider profile-doc <file.spd | profile>                   print an AI cheat sheet (Markdown)
```

## Editor

| Action | How | Changes |
|---|---|---|
| Move a node (pins it) | drag | layout |
| Move a node into / out of a box | drag it onto the box / out of it | code |
| Resize a node or set a box's minimum size | select, drag the corner handle | layout |
| Connect two nodes | select, drag the **⊕** handle onto another node | code |
| Add a node | drag a kind from the palette (drop on a box to put it inside) | code |
| Rename a label | double-click or **F2** | code |
| Rename an id | select, **I** | code + layout |
| Delete | **Del** | code |
| Move a line | select it, drag a segment handle sideways | layout (manual route) |
| Change where a line attaches | drag a line end along a side, or onto another side | layout |
| Back to automatic routing | select the line, **R** / Reset route | layout |
| Unpin / re-layout unpinned nodes | **U** / Unpin, Reset layout | layout |
| Undo / redo (code and canvas) | **Ctrl+Z**, **Ctrl+Shift+Z** / **Ctrl+Y** | both |
| Zoom / fit | wheel, **+ − 0**, slider, **F** | — |
| Export | SVG / PNG buttons | — |

Typing in the code updates the diagram live; errors and warnings show inline. Editing the
files in another editor updates the open page. Add `?debug` to the URL to expose internals in
the browser console.

## Profiles: your own diagram types

Diagram types are **profiles**: a folder with a `profile.yaml` and optional SVG icons. The
built-ins (`base/architecture`, `base/flowchart`) use the same format as yours. Profiles are
looked up next to the diagram, in `./profiles`, then the built-ins.

```yaml
# profiles/acme/k8s/profile.yaml
name: acme/k8s
version: 1.0.0
nodes:
  deployment:
    description: Runs and scales a set of identical pods.
    icon: icons/deployment.svg          # 24x24, use currentColor
    shape: rounded                      # rect rounded cylinder circle hexagon diamond …
    props: { image: string, replicas: number }
  namespace: { container: true, allows: [deployment], style: { dashed: true } }
edges:
  mounts: { style: dotted, arrow: end }
rules:
  - forbid: ingress -> deployment
    message: Ingress should route to a Service
    severity: warning
```

Use it with an alias next to other profiles — `use acme/k8s@1 as k8s`, then `k8s.deployment web`
and `a -> b : k8s.mounts`. See `examples/kubernetes.spd`. Run `spider profile-doc` on a diagram
to get a cheat sheet you can give to an AI so it writes valid diagrams for your profile.

## Project docs

`DESIGN.md` (design and decisions) · `PLAN.md` (phases) · `BACKLOG.md` (review findings,
design rules) · `CLAUDE.md` (notes for AI assistants working on the code).

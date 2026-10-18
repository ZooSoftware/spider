# Grammar (v0)

One generic grammar for every diagram type ([0005](../decisions/0005-one-generic-grammar.md)):
`kind id "label" { props }` and `a -> b : kind "label"`. Profiles give meaning to kinds; they
never change the syntax. Keep it small and AI-friendly: any change needs a decision record
and updates to this page, the highlighter and the cheat sheet.

Implemented in `packages/core` (`lexer.ts`, `parser.ts`, `build.ts`).

## Example

```
# Checkout flow
use base/architecture

user customer "Customer"

zone vpc "Production VPC" {
  service api   "API Gateway"   { tech: "Kong" }
  service order "Order Service" { tech: "Go"  replicas: 3 }
  db      orders_db "Orders DB" { engine: "Postgres" }
}

external stripe "Stripe"

customer -> api   : "HTTPS"
api -> order      : "REST"
order -> orders_db : data
order -> stripe   : async "charge"
```

## Syntax

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

## Rules

- **Whitespace and newlines are not significant**, and several statements may share a line,
  with one exception: the token that must follow `use`, `@`, `as`, `->`, `:`, `.` or a node
  kind has to be on the **same line**. A half-typed line never swallows the next statement.
- **Keywords are positional.** `use` is a keyword only at the start of a statement that isn't
  an edge or prop (`use -> x` is an edge). `as` is a keyword only inside `use`.
- **Node ids are explicit** and globally unique ([0003](../decisions/0003-explicit-node-ids-edge-ids-from-endpoints.md)).
- **Edges.** In `a -> b : "REST"` the edge has a label and no kind; `a -> b : async "x"` has
  both. Edge ids are `a->b`, then `a->b#2`, `a->b#3` in source order. Edges inside blocks are
  global (they don't belong to the container). An edge with no kind uses the profile's `defaultEdge`.
- **Containers.** A node is a container when its block holds at least one child node. A block
  may mix props and statements. Membership is written in code, by nesting
  ([0017](../decisions/0017-container-membership-is-code.md)).
- **Namespaces.** `use acme/k8s@1 as k8s` makes that profile's kinds `k8s.<kind>`, for nodes
  (`k8s.pod web`) and edges (`a -> b : k8s.mounts`) ([0019](../decisions/0019-namespaced-kinds-via-use-as.md)).

## Guarantees

- **Lossless:** every token carries leading and trailing trivia (trailing runs up to and
  including the first line break). `print(parse(text)) === text` for any input, including
  invalid input.
- **Never throws:** skipped tokens become `Error` items, parsing resumes at the next
  identifier, `}` or end of file. Diagnostics: [diagnostics.md](diagnostics.md).
- **Model diagnostics:** duplicate node id → error, the first node is kept; edge to an unknown
  id → error, the edge is kept; duplicate prop key → warning, the last value wins.

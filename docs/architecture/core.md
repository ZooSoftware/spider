# Core

`packages/core`: text in, model and text edits out. No DOM, no Node, no knowledge of diagram types.

```
text ─lexer─► tokens (+ trivia) ─parser─► lossless CST ─build─► Model + diagnostics
                                              │
                         write-back ops ◄─────┘──► TextEdit[] ─► new text ─► (re-parse)
```

| File | Job |
|---|---|
| `lexer.ts` | text → tokens with UTF-16 spans. Whitespace and comments are **trivia** attached to tokens (Roslyn style) |
| `cst.ts` | the concrete syntax tree, the printer, span helpers |
| `parser.ts` | recursive descent: tokens → CST. Never throws |
| `build.ts` | CST → `Model` with stable IDs; tolerates partial trees |
| `edits.ts` | `TextEdit` splicing |
| `writeback.ts` | structural operations → `TextEdit[]` |
| `model.ts` | the shared contract (model, spans, diagnostics, `edgeId`) |

## Lossless CST

Every token carries its leading trivia and its trailing trivia (up to and including the
first line break), and every token lives in exactly one CST node. So
`print(parse(text)) === text` holds for **any** input, including invalid and half-typed text.
The tree is never pretty-printed ([0008](../decisions/0008-hand-written-parser-lossless-cst.md)).

## Error recovery

On unexpected input the parser emits a `parse/…` diagnostic, wraps the skipped tokens in an
`Error` item, and resyncs at the next identifier (a plausible statement start), `}` or the end.
The token that must follow `use`, `@`, `as`, `->`, `:`, `.` or a node kind has to be on the
same line, so a half-typed line never swallows the statement on the next line.

## Model building

- Node IDs are explicit and global; edges get `a->b`, `a->b#2`, … in source order; edges
  inside blocks are global ([0003](../decisions/0003-explicit-node-ids-edge-ids-from-endpoints.md)).
- A node is a container when its block holds at least one child node.
- Duplicate node id: error, the first is kept. Edge to an unknown id: error, the edge is kept.
  Duplicate prop: warning, the last value wins.
- Incomplete statements are skipped (the parser already reported them).

## Write-back

Canvas edits that change meaning become **text splices** on the current source
([0009](../decisions/0009-write-back-is-text-splices.md)). Each operation re-parses the text it
is given, finds statements by span, and returns `TextEdit[]`; everything else stays
byte-identical, including comments, blank lines, indentation and CRLF.

| Operation | Effect on the code |
|---|---|
| `addEdge(text, a, b, { kind?, label? })` | inserts `a -> b` |
| `addNode(text, { kind, id?, label?, parent? })` | inserts `kind id "Label"` (a unique id if none given), inside `parent`'s block if dropped in a container; returns the edits and the id |
| `deleteElements(text, targets)` | removes the nodes' statements and their edges' statements; removing a statement between two blank lines also removes one blank line |
| `setLabel(text, target, label)` | replaces or inserts the label string |
| `moveNode(text, id, parent?)` | moves the node's statement into (or out of) a container block ([0017](../decisions/0017-container-membership-is-code.md)) |
| `renameId(text, old, new)` | renames the id and every reference to it; `renameEdgeId` gives the new edge ids so the editor re-keys the layout too |

Every operation has an exact-output test and a property test over all `examples/*.spd`
(valid code afterwards, model as expected).

# 0005. One generic grammar; profiles never change syntax

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** original design; [reference/grammar.md](../reference/grammar.md)

## Context

Each diagram type could get its own syntax (as PlantUML does), but then the parser, write-back,
highlighter and AI prompts multiply with every type.

## Decision

The syntax is generic: `kind id "label" { props }` and `a -> b : kind "label"`. Profiles give
meaning to kinds; they never change the grammar. The DSL stays small and AI-friendly; any
grammar change needs a decision record.

## Consequences

- One parser, one write-back, one highlighter, one cheat-sheet syntax section for all types.
- An LLM learns one syntax and a per-profile list of kinds.
- Some types read less naturally than a bespoke syntax would; types whose layout is fixed by
  their syntax (sequence diagrams) are out of scope.

## Alternatives considered

- **Per-profile syntax:** out of scope for v1 ([roadmap](../roadmap.md)).

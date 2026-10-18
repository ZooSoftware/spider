# 0019. Namespaced kinds via `use … as`

- **Status:** accepted
- **Date:** 2026-10-18
- **Where:** spec 001 phase 7 (found with the custom profile example); `profiles/src/load.ts`, `core/src/parser.ts`

## Context

A diagram may combine several profiles (`base/architecture` and a team's `acme/k8s`), and their
kind names clash (`service`). The custom profile example also showed namespaced **edge** kinds
(`: k8s.mounts`) weren't parseable.

## Decision

`use acme/k8s@1 as k8s` namespaces **everything** that profile defines: node kinds, edge kinds,
`allows`, `allowed` pairs, rule pairs and `defaultEdge` become `k8s.<name>`. The grammar allows
one `.` in a kind, for nodes and edges. Un-aliased profiles share a namespace; a clash is a
warning and the later `use` wins.

## Consequences

- Profiles compose without renaming; rules inside a profile keep working under an alias.
- Kinds have at most one level of namespace.

## Alternatives considered

- **Requiring unique kind names across profiles:** breaks as soon as two teams pick the same word.

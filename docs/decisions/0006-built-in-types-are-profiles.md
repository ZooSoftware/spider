# 0006. Built-in diagram types are ordinary profiles

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** original design; `profiles/builtin/base/architecture`, `profiles/builtin/base/flowchart`

## Context

Diagram types should be customizable by users. If built-in types were hard-coded, the user
path would be second-class and drift from the built-ins.

## Decision

Diagram types are **not hard-coded**. A profile defines the allowed space for a type, and the
built-in types (`base/architecture`, `base/flowchart`) are plain profiles loaded by the same
loader as user profiles. `core` knows nothing about specific diagram types.

## Consequences

- Every feature a built-in type uses is available to user profiles.
- Code never special-cases a built-in kind; layout and render read everything from the profile.
- `base/flowchart` exists partly to prove the point.

## Alternatives considered

- **Hard-coded built-ins with a plugin API for others:** two mechanisms to keep in sync.

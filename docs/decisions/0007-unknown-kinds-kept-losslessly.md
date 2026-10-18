# 0007. Unknown kinds and missing profiles are kept losslessly

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** original design; `profiles/src/validate.ts`, `render/src/render.ts`

## Context

A diagram may be opened without its profile (not installed, a typo, a newer version), or use a
kind the profile doesn't define yet. If tools dropped or rewrote what they don't understand, a
round trip through the editor would destroy data.

## Decision

An unknown kind or a missing profile is a **warning**. The node is kept as written, renders as a
generic box, and write-back never drops or rewrites it.

## Consequences

- A diagram always renders, and editing it never loses data.
- Errors are reserved for real rule violations (containment, `allowed`, `forbid`).

## Alternatives considered

- **Errors and refusing to render:** safer-looking, but blocks half-written diagrams and
  diagrams shared without their profile.

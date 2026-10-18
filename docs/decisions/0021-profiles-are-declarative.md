# 0021. Profiles are declarative; code plugins are deferred

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** original design; [reference/profile-format.md](../reference/profile-format.md), `profiles/src/sanitize.ts`

## Context

Users need their own kinds, icons, rules and themes. Arbitrary code in profiles is powerful but
is a security risk (profiles get shared) and makes profiles hard to validate or describe to an AI.

## Decision

- Profiles are **declarative YAML + SVG icons**, validated by a versioned Zod schema. YAML
  covers icons, shapes, ports, edge styles, containment, validation rules and layout hints.
- **User SVG is sanitized** before render (allowlist; scripts, handlers and external refs removed).
- Profiles feed the AI: each one generates a cheat sheet (`spider profile-doc`).
- An optional `plugin.ts` (custom validators, renderers, layout strategies), sandboxed in a Web
  Worker and opt-in, stays a **later** option.
- Versioning: a diagram can pin `use x@1.2`. A lockfile and npm/git/URL sources are later.

## Consequences

- Profiles are safe to share and easy to generate.
- Anything YAML can't express waits for the plugin design.
- Schema changes are contract changes: additive, and render must handle new shapes/styles.

## Alternatives considered

- **Code-first profiles:** flexible, unsafe to share, opaque to validation and AI.

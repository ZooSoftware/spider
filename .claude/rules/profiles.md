---
paths:
  - "packages/profiles/**"
  - "packages/profile-schema/**"
  - "examples/profiles/**"
---

# Profiles

- Built-in diagram types are ordinary profiles: never special-case them in code.
- Profiles are declarative YAML + SVG icons. Icons are 24x24 line icons using
  `currentColor`; all user SVG goes through `sanitizeSvg`.
- `use x as k8s` namespaces everything the profile defines: node kinds, edge kinds,
  `allows`, `allowed` pairs, rule pairs, `defaultEdge`.
- Unknown kinds are warnings and render as generic boxes — data is never dropped.
- Schema changes (`profile-schema`) are contract changes: additive, and the renderer must
  handle any new shape or style.

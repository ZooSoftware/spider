# Profiles

A profile defines the allowed space for a diagram type: node kinds, edge kinds, shapes, icons,
containment, rules, theme and layout hints. Built-in types are ordinary profiles
([0006](../decisions/0006-built-in-types-are-profiles.md)); profiles are declarative
([0021](../decisions/0021-profiles-are-declarative.md)). Format: [reference/profile-format.md](../reference/profile-format.md).

`packages/profiles`:

| File | Job | Pure? |
|---|---|---|
| `load.ts` | `use` declarations → one `ResolvedProfile` + diagnostics | reads files (Node) |
| `validate.ts` | model + resolved profile → diagnostics | yes |
| `sanitize.ts` | allowlist SVG sanitizer for icons | yes |
| `cheatsheet.ts` | resolved profile → short Markdown for an LLM prompt | yes |
| `kinds.ts` | kind names and `"a -> b"` pair helpers | yes |
| `builtin/base/architecture`, `builtin/base/flowchart` | built-in profiles (YAML + icons) | — |

The browser never loads profiles: the dev server does and sends the resolved profile over HTTP.
The browser typecheck guarantees the editor can't import `load.ts` by accident.

## Loading

For each `use <name>[@version] [as alias]`:

1. **Locate** `<root>/<name>/profile.yaml`, trying the roots in order: the host's search paths
   (diagram folder, its `./profiles`, then `./profiles` of the cwd), then the built-ins.
   Not found → `profile/not-found` warning; its kinds render as generic boxes.
2. **Parse** YAML and validate against `ProfileDef` (Zod).
3. **Resolve `extends`** recursively (one name or a list), cycle-safe (`profile/extends-cycle`).
   Merge rules: a kind defined again is merged field by field, and its `props`, `style` and
   `layout` objects are merged one level deep; `rules` are appended; `theme` and `layout` are
   merged; a later `defaultEdge` wins. A child that re-declares `icon` brings its own icon.
4. **Load icons** relative to the profile folder (must be an `.svg` inside it) and sanitize them.
5. **Check the version**: `1.2` accepts `1.2`, `1.2.0`, `1.2.x`, not `1.20` or `1.3.0`
   (`profile/version-mismatch` warning).
6. **Namespace** under the alias ([0019](../decisions/0019-namespaced-kinds-via-use-as.md)):
   with `as k8s`, every kind the profile defines becomes `k8s.<kind>`, and so do its references
   (`allows`, `allowed` pairs, rule pairs, `defaultEdge`).
7. **Merge** all uses into one profile. Later un-aliased uses win on kind clashes (`profile/kind-clash`).

No `use` at all → an empty profile and a `profile/none` info. Loading never throws.

## Validation

`validate(model, profile)` is pure; diagnostics carry model spans.

| Check | Code | Severity |
|---|---|---|
| node kind not in the profile | `profile/unknown-kind` | warning, node kept and drawn as a generic box ([0007](../decisions/0007-unknown-kinds-kept-losslessly.md)) |
| children under a non-container kind | `profile/not-container` | warning |
| child kind not in the container's `allows` | `profile/containment` | error |
| edge kind not in the profile | `profile/unknown-edge-kind` | warning |
| edge kind's `allowed` pairs don't match | `profile/edge-not-allowed` | error |
| a `forbid` rule matches | `profile/forbidden` | the rule's severity |
| prop not declared on the kind | `profile/unknown-prop` | warning |
| prop value of the wrong type | `profile/prop-type` | warning |

## Cheat sheets

`profileCheatSheet(profile)` produces a short Markdown page: the syntax, the node kinds with
their props, the edge kinds, the rules and a tiny example, meant to be pasted into an LLM
prompt (`spider profile-doc`). Profiles feed the AI automatically.

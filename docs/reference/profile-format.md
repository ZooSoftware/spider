# Profile format (`profile.yaml`)

A profile is a folder: `profile.yaml` plus optional SVG icons. Source of truth:
`profile-schema/src/index.ts` (Zod `ProfileDef`). How loading works:
[architecture/profiles.md](../architecture/profiles.md).

```
profiles/acme/k8s/
  profile.yaml
  icons/*.svg      24×24 line icons using currentColor; sanitized on load
```

## Example

Excerpt of `examples/profiles/acme/k8s/profile.yaml`, plus an `extends` line to show inheritance:

```yaml
name: acme/k8s
version: 1.0.0
description: Kubernetes building blocks used at ACME (example of a user-defined profile).
# extends: base/architecture     # one name or a list; inherit, then override

nodes:
  cluster:
    description: A Kubernetes cluster.
    icon: icons/cluster.svg
    shape: rounded
    container: true
    allows: [namespace]            # containment rule
    style: { stroke: "#326ce5" }
  ingress:
    description: HTTP entry point into the cluster.
    icon: icons/ingress.svg
    shape: rounded
    layout: { layer: first }       # placement hint
  service:
    icon: icons/service.svg
    shape: hexagon
    size: [130, 54]
  deployment:
    icon: icons/deployment.svg
    shape: rounded
    props: { image: string, replicas: number }

edges:
  routes: { description: Network traffic., style: solid, arrow: end, color: "#326ce5" }
  mounts: { style: dotted, arrow: end }
defaultEdge: routes

rules:
  - forbid: ingress -> deployment
    message: Ingress should route to a Service, not directly to a Deployment
    severity: warning

theme:
  containerFill: "#f5f8ff"
```

## Top level

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | `a/b/c` (`[\w-]+` segments) | required | what `use` refers to; its folder path under a search root |
| `version` | string | `"0.0.0"` | `use x@1.2` matches `1.2`, `1.2.0`, `1.2.x` |
| `description` | string | — | shown in the cheat sheet |
| `extends` | string or string[] | — | profiles to inherit from |
| `nodes` | map kind → node kind | `{}` | |
| `edges` | map kind → edge kind | `{}` | |
| `defaultEdge` | string | — | edge kind for edges without `: kind` |
| `rules` | rule[] | `[]` | |
| `theme` | theme | `{}` | |
| `layout` | layout defaults | `{}` | |

## Node kind (all fields optional)

| Field | Type | Notes |
|---|---|---|
| `description` | string | cheat sheet |
| `icon` | path to an `.svg` inside the profile folder | |
| `shape` | `rect` `rounded` `cylinder` `circle` `hexagon` `person` `cloud` `queue` `diamond` `parallelogram` | default box when unset |
| `size` | `[w, h]` (positive) | default 140×60; text scales against it |
| `label` | `center` `below` `top` | |
| `props` | map name → `string` `number` `boolean` | undeclared or wrongly typed props are warnings |
| `ports` | sides: `left` `right` `top` `bottom` | sides lines may attach to |
| `container` | boolean | may hold child nodes |
| `allows` | kinds | allowed direct children; omitted = any |
| `layout` | `{ layer: first \| last }` | placement hint for ELK |
| `style` | `{ fill, stroke, strokeWidth, textColor, dashed }` | |

## Edge kind (all fields optional)

| Field | Type | Notes |
|---|---|---|
| `description` | string | |
| `style` | `solid` `dashed` `dotted` | |
| `arrow` | `none` `end` `start` `both` | |
| `color` | string | |
| `allowed` | `"kindA -> kindB"` pairs (`*` = any) | only these pairs may use this edge kind |

## Rule

| Field | Type | Default |
|---|---|---|
| `forbid` | `"kindA -> kindB"` (`*` = any) | required |
| `message` | string | required |
| `severity` | `error` `warning` | `error` |

## Theme and layout defaults

- `theme`: `background`, `fontFamily`, `fontSize`, `nodeFill`, `nodeStroke`, `textColor`,
  `edgeColor`, `containerFill`, `containerStroke`.
- `layout`: `direction` (`RIGHT` `DOWN` `LEFT` `UP`, default `RIGHT`), `nodeSpacing` (50),
  `layerSpacing` (80).

## Namespacing

With `use acme/k8s as k8s`, everything the profile defines is prefixed: node and edge kinds,
`allows`, `allowed` pairs, rule pairs and `defaultEdge` ([0019](../decisions/0019-namespaced-kinds-via-use-as.md)).

## Not implemented yet

From the original design, kept for later ([roadmap](../roadmap.md)): a separate `theme.yaml`,
an opt-in sandboxed `plugin.ts`, profile sources other than local folders (npm, git, URL) and
a lockfile.

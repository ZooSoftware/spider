# Diagnostic codes

Every problem is a `Diagnostic { severity, code, message, span? }` (`core/src/model.ts`).
Nothing throws on user input. Codes are stable: tools may match on them. New codes use the
prefix of the stage that finds them.

`spider check` prints them as `file:line:col severity code: message` with an excerpt, and
exits 1 if any is an error. The editor shows them inline.

## `parse/…` (core, parser): all errors

| Code | Meaning |
|---|---|
| `parse/unexpected-token` | a token that can't start or continue a statement |
| `parse/unexpected-close` | `}` with no open block |
| `parse/unexpected-block` | `{` where a block can't start |
| `parse/unclosed-block` | `{` never closed |
| `parse/unterminated-string` | string not closed on its line |
| `parse/prop-outside-block` | `key: value` at the top level |
| `parse/expected-id` | node kind not followed by an id |
| `parse/expected-kind` | `.` not followed by the rest of a namespaced kind |
| `parse/expected-target` | `->` not followed by a node id |
| `parse/expected-edge-kind` | `:` in an edge not followed by a kind or label |
| `parse/expected-value` | prop without a value |
| `parse/expected-profile` | `use` without a profile name |
| `parse/expected-version` | `@` without a version |
| `parse/expected-alias` | `as` without an alias |

## `model/…` (core, model builder)

| Code | Severity | Meaning |
|---|---|---|
| `model/duplicate-id` | error | a node id is used twice; the first node is kept |
| `model/unknown-node` | error | an edge points to an id that doesn't exist; the edge is kept |
| `model/duplicate-prop` | warning | a prop key is set twice; the last value wins |

## `profile/…` (profiles: loading)

| Code | Severity | Meaning |
|---|---|---|
| `profile/none` | info | no `use`: everything renders as generic boxes |
| `profile/not-found` | warning | profile not in any search path; its kinds render as generic boxes |
| `profile/invalid-name` | error | profile name isn't `a/b` segments |
| `profile/invalid-yaml` | error | `profile.yaml` isn't valid YAML |
| `profile/invalid-schema` | error | `profile.yaml` doesn't match the schema (with the field path) |
| `profile/extends-cycle` | error | `extends` loops back |
| `profile/version-mismatch` | warning | `use x@v` doesn't match the profile's version |
| `profile/duplicate-use` | warning | the same profile is used twice |
| `profile/kind-clash` | warning | two un-aliased profiles define the same kind; the later one wins |
| `profile/icon-invalid` | warning | icon isn't an `.svg` inside the profile folder |
| `profile/icon-missing` | warning | icon file not found |

## `profile/…` (profiles: validation)

| Code | Severity | Meaning |
|---|---|---|
| `profile/unknown-kind` | warning | node kind not in the profile; kept and drawn as a generic box |
| `profile/not-container` | warning | a node with children whose kind isn't a container |
| `profile/containment` | error | a child kind not in the container's `allows` |
| `profile/unknown-edge-kind` | warning | edge kind not in the profile |
| `profile/edge-not-allowed` | error | edge kind used between kinds not in its `allowed` pairs |
| `profile/forbidden` | rule's severity | a `forbid` rule matched; message from the rule |
| `profile/unknown-prop` | warning | prop not declared on the kind |
| `profile/prop-type` | warning | prop value has the wrong type |

## `layout/…` (layout)

| Code | Severity | Meaning |
|---|---|---|
| `layout/overlaps-container` | warning | a container's box covers a node that isn't inside it (shown, never auto-fixed) |
| `layout/invalid-json` | error | the layout file isn't valid JSON; an empty layout is used |
| `layout/invalid-file` | error | the layout file isn't a JSON object |
| `layout/version` | warning | unsupported layout version, read as version 1 |
| `layout/invalid-node` | warning | an invalid node entry, ignored |
| `layout/invalid-edge` | warning | an invalid edge entry, ignored |

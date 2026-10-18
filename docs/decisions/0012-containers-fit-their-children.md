# 0012. Containers fit their children; a resize only sets a minimum

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 backlog B8, phase 10; `layout/src/geometry.ts` (`fitContainers`)

## Context

A container could end up drawn over nodes that aren't inside it: a pinned container only grew,
never shrank, and fitting ignored non-members. Users couldn't fix it by hand.

## Decision

- A container's box **always fits its real children** exactly (padding + title space), pinned or not.
  Dragging a container moves its subtree.
- A container resize handle stores a **minimum** size (`minW`/`minH`): the box is
  `max(fit, minimum)`, never smaller than its content.
- A container covering a non-member is reported and outlined ([0011](0011-user-edits-never-move-other-nodes.md)).

## Consequences

- A container's box always tells the truth about membership.
- Membership changes are code changes ([0017](0017-container-membership-is-code.md)).

## Alternatives considered

- **Free container sizes:** boxes stop reflecting membership.
- **Auto-moving non-members out:** cascades ([0011](0011-user-edits-never-move-other-nodes.md)).

# 0004. Orphan layout entries are dropped; the editor remembers them for the session

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** prototype default for open question "orphan policy" (spec 001), phase 5; `layout/src/layout-io.ts` (`reconcileLayout`), `editor/src/app.ts`

## Context

When a node disappears from the code, its layout entry has no owner. Keeping orphans forever
grows the file; dropping them at once loses positions when someone cuts and pastes a statement,
or is half-way through typing an id.

## Decision

- Orphan entries are **dropped** on reconcile, so on the next save.
- The editor **remembers** positions of nodes that vanish during the session and restores them
  when the id comes back (passed to `analyze` as a `previous` function of the model).

## Consequences

- The sidecar only ever describes the current model.
- Typing over an id in the editor doesn't throw its position away.
- Removing a node in an external editor and putting it back later re-places it.

## Alternatives considered

- **Keep orphans for N saves:** survives cut/paste across sessions, but the file carries stale
  data and needs an expiry policy. Can be revisited if it hurts.

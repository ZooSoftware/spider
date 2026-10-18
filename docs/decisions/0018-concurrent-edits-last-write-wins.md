# 0018. Concurrent edits: last write wins, external changes are pushed

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** prototype default for open question "conflicts" (spec 001); `editor/src/server.ts`, `io.ts`

## Context

The `.spd` can be edited in the spider editor and in another editor (or by an AI) at the same
time. A real merge is complex; ignoring outside changes loses work.

## Decision

- **Last write wins.**
- The dev server watches the files and pushes changes it didn't write to the browser over SSE;
  the editor replaces its text/layout and recompiles.
- Our own writes never echo back: the server tracks the last content known on disk, in-flight
  writes and a version per file, and drops reads that overlap a save.

## Consequences

- Simple and predictable for one person (plus an AI) working on a file.
- Two people typing at once can overwrite each other. Real-time multi-user editing is out of scope.

## Alternatives considered

- **Three-way merge of text and layout:** better for concurrent editing, a lot of work; revisit
  if it becomes a real problem ([roadmap](../roadmap.md#open-questions)).

# 0015. The pipeline runs in the browser; the server only does file IO

- **Status:** accepted
- **Date:** 2026-10-17
- **Where:** spec 001 phase 5; `editor/src/app.ts`, `editor/src/server.ts`

## Context

The editor needs to re-parse and re-layout on every keystroke and re-route on every drag frame.
Round trips to a server would add latency, and a server that computes would be one more place
the pipeline runs.

## Decision

Parse, layout, routing and render run **in the browser**. The dev server only reads and writes
the `.spd` and its sidecar, loads profiles, and pushes external file changes over SSE. It binds
to `127.0.0.1` only.

## Consequences

- Live feedback with no network in the loop.
- The pure packages must run in the browser (enforced by the pure and browser typechecks).
- Profiles are loaded on the server and sent resolved; the browser never reads files.
- The same browser-side pipeline can back a future hosted or VS Code webview editor.

## Alternatives considered

- **Server-side pipeline:** latency on every frame, and more server surface.
